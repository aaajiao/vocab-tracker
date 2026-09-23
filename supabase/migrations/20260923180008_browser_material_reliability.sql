-- 网页与 Codex 共用句子写入；保留完整分析和独立收据，避免重试复活已删除内容。
CREATE TABLE public.sentence_write_requests (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sentence_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sentence_write_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sentence_write_requests TO service_role;
CREATE INDEX idx_sentence_write_requests_user ON public.sentence_write_requests(user_id,created_at);

CREATE OR REPLACE FUNCTION public.learning_save_sentence(p_user_id uuid,p_sentence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET timezone='UTC' AS $$
DECLARE
    v_id uuid;
    v_words jsonb;
    v_keywords jsonb;
    v_grammar jsonb;
    v_created_at timestamptz;
    v_payload jsonb;
    v_request public.sentence_write_requests%ROWTYPE;
    v_sentence public.saved_sentences%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR p_sentence IS NULL OR jsonb_typeof(p_sentence)<>'object'
       OR NOT(p_sentence ?& ARRAY['id','sentence','language'])
       OR (p_sentence-ARRAY['id','sentence','sentence_cn','language','scene','source_words','source_type','keywords','grammar','created_at'])<>'{}'::jsonb
       OR jsonb_typeof(p_sentence->'sentence')<>'string'
       OR char_length(btrim(p_sentence->>'sentence')) NOT BETWEEN 1 AND 4000
       OR p_sentence->>'language' IS NULL OR p_sentence->>'language' NOT IN ('en','de')
       OR COALESCE(p_sentence->>'source_type','combined') NOT IN ('word','combined','input')
       OR EXISTS(SELECT 1 FROM jsonb_each(p_sentence) item WHERE item.key IN ('sentence_cn','scene','created_at') AND jsonb_typeof(item.value) NOT IN ('string','null'))
       OR char_length(COALESCE(p_sentence->>'sentence_cn',''))>4000
       OR char_length(COALESCE(p_sentence->>'scene',''))>100
       OR EXISTS(SELECT 1 FROM jsonb_each(p_sentence) item WHERE item.key IN ('source_words','keywords','grammar') AND jsonb_typeof(item.value)<>'array') THEN
        RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='invalid_sentence';
    END IF;
    BEGIN
        v_id:=(p_sentence->>'id')::uuid;
        IF p_sentence->>'created_at' IS NOT NULL THEN
            IF p_sentence->>'created_at' !~ '^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$' THEN
                RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='invalid_sentence_time';
            END IF;
            v_created_at:=(p_sentence->>'created_at')::timestamptz;
        END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='invalid_sentence';
    END;
    v_words:=COALESCE(p_sentence->'source_words','[]'::jsonb);
    v_keywords:=COALESCE(p_sentence->'keywords','[]'::jsonb);
    v_grammar:=COALESCE(p_sentence->'grammar','[]'::jsonb);
    IF v_id IS NULL OR jsonb_array_length(v_words)>50 OR jsonb_array_length(v_keywords)>50 OR jsonb_array_length(v_grammar)>50
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_words) value WHERE jsonb_typeof(value)<>'string' OR char_length(btrim(value#>>'{}')) NOT BETWEEN 1 AND 200)
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_keywords) value WHERE jsonb_typeof(value)<>'object'
           OR NOT(value ?& ARRAY['word','meaning']) OR (value-ARRAY['word','meaning','partOfSpeech'])<>'{}'::jsonb
           OR jsonb_typeof(value->'word')<>'string' OR char_length(btrim(value->>'word')) NOT BETWEEN 1 AND 200
           OR jsonb_typeof(value->'meaning')<>'string' OR char_length(btrim(value->>'meaning')) NOT BETWEEN 1 AND 1000
           OR (value ? 'partOfSpeech' AND (jsonb_typeof(value->'partOfSpeech')<>'string' OR char_length(value->>'partOfSpeech')>80)))
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_grammar) value WHERE jsonb_typeof(value)<>'object'
           OR NOT(value ?& ARRAY['point','explanation']) OR (value-ARRAY['point','explanation'])<>'{}'::jsonb
           OR jsonb_typeof(value->'point')<>'string' OR char_length(btrim(value->>'point')) NOT BETWEEN 1 AND 200
           OR jsonb_typeof(value->'explanation')<>'string' OR char_length(btrim(value->>'explanation')) NOT BETWEEN 1 AND 2000) THEN
        RAISE EXCEPTION USING ERRCODE='PT400',MESSAGE='invalid_sentence_analysis';
    END IF;
    v_payload:=jsonb_build_object('id',v_id,'sentence',p_sentence->>'sentence','sentence_cn',COALESCE(p_sentence->>'sentence_cn',''),
        'language',p_sentence->>'language','scene',COALESCE(p_sentence->>'scene',''),
        'source_type',COALESCE(p_sentence->>'source_type','combined'),'source_words',v_words,'keywords',v_keywords,'grammar',v_grammar,'created_at',v_created_at);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sentence:'||v_id::text,0));
    SELECT * INTO v_request FROM public.sentence_write_requests WHERE id=v_id;
    IF FOUND THEN
        IF v_request.user_id<>p_user_id OR v_request.request_payload<>v_payload THEN
            RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='sentence_request_conflict';
        END IF;
        SELECT * INTO v_sentence FROM public.saved_sentences WHERE id=v_id AND user_id=p_user_id;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404',MESSAGE='sentence_no_longer_exists'; END IF;
        RETURN to_jsonb(v_sentence);
    END IF;
    SELECT * INTO v_sentence FROM public.saved_sentences WHERE id=v_id FOR UPDATE;
    IF FOUND THEN
        -- 兼容旧版已保存的句子；首次新式重试只补收据，不改原内容。
        IF v_sentence.user_id<>p_user_id OR v_sentence.sentence<>p_sentence->>'sentence'
           OR COALESCE(v_sentence.sentence_cn,'')<>COALESCE(p_sentence->>'sentence_cn','')
           OR v_sentence.language<>p_sentence->>'language' OR COALESCE(v_sentence.scene,'')<>COALESCE(p_sentence->>'scene','')
           OR v_sentence.source_type<>COALESCE(p_sentence->>'source_type','combined')
           OR v_sentence.source_words<>v_words OR COALESCE(v_sentence.keywords,'[]'::jsonb)<>v_keywords OR COALESCE(v_sentence.grammar,'[]'::jsonb)<>v_grammar
           OR (v_created_at IS NOT NULL AND v_sentence.created_at<>v_created_at) THEN
            RAISE EXCEPTION USING ERRCODE='PT409',MESSAGE='sentence_id_conflict';
        END IF;
    ELSE
        INSERT INTO public.saved_sentences(id,user_id,sentence,sentence_cn,language,scene,source_type,source_words,keywords,grammar,created_at)
        VALUES(v_id,p_user_id,p_sentence->>'sentence',p_sentence->>'sentence_cn',p_sentence->>'language',p_sentence->>'scene',
            COALESCE(p_sentence->>'source_type','combined'),v_words,v_keywords,v_grammar,COALESCE(v_created_at,now())) RETURNING * INTO v_sentence;
    END IF;
    INSERT INTO public.sentence_write_requests(id,user_id,request_payload) VALUES(v_id,p_user_id,v_payload);
    RETURN to_jsonb(v_sentence);
END;
$$;
REVOKE ALL ON FUNCTION public.learning_save_sentence(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.learning_save_sentence(uuid,jsonb) TO service_role;
