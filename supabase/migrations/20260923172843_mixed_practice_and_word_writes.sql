-- 混合材料沿用现有 SRS 选词；新增词汇写入独立授权与幂等收据。
ALTER TABLE public.api_access_tokens DROP CONSTRAINT api_access_tokens_scopes_check;
ALTER TABLE public.api_access_tokens ADD CONSTRAINT api_access_tokens_scopes_check CHECK (
    cardinality(scopes) BETWEEN 1 AND 4
    AND scopes <@ ARRAY['vocabulary:read','vocabulary:write','practice:write','sentences:write']::text[]
    AND array_position(scopes,NULL) IS NULL
);

ALTER TABLE public.practice_sessions ADD COLUMN sentence_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.practice_sessions ALTER COLUMN word_ids SET DEFAULT '{}';
ALTER TABLE public.practice_sessions DROP CONSTRAINT practice_sessions_language_check;
ALTER TABLE public.practice_sessions DROP CONSTRAINT practice_sessions_word_ids_check;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_language_check CHECK (language IN ('en','de','mixed'));
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_sessions_material_ids_check CHECK (
    cardinality(word_ids) + cardinality(sentence_ids) BETWEEN 1 AND 100
    AND array_position(word_ids,NULL) IS NULL AND array_position(sentence_ids,NULL) IS NULL
);

CREATE TABLE public.word_write_requests (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 不级联删除收据，旧请求不能复活用户已删除的词。
    word_id uuid NOT NULL,
    request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload)='object'),
    created boolean NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.word_write_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.word_write_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.word_write_requests TO service_role;
CREATE INDEX idx_word_write_requests_user ON public.word_write_requests(user_id,created_at);
CREATE INDEX idx_words_owner_normalized ON public.words(user_id,language,lower(btrim(word)));

CREATE FUNCTION public.learning_get_practice_materials(
    p_user_id uuid,
    p_language text DEFAULT NULL,
    p_timezone text DEFAULT NULL,
    p_limit integer DEFAULT 10
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_timezone text;
    v_review jsonb;
    v_words_available integer;
    v_sentences_available integer;
    v_word_count integer;
    v_sentence_count integer;
    v_due integer;
    v_words jsonb;
    v_sentences jsonb;
BEGIN
    IF p_user_id IS NULL OR (p_language IS NOT NULL AND p_language NOT IN ('en','de'))
       OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_material_query';
    END IF;
    SELECT COALESCE(p_timezone,(SELECT timezone FROM public.learning_preferences WHERE user_id=p_user_id),'Europe/Berlin') INTO v_timezone;
    -- 排序、时区、缺失状态回填与在线复习完全共用，不另造遗忘曲线或重置进度。
    v_review:=public.learning_get_review(p_user_id,p_language,'all',v_timezone,p_limit,0);
    v_words_available:=(v_review#>>'{meta,counts,total_tracked}')::integer;
    SELECT count(*)::integer INTO v_sentences_available FROM public.saved_sentences
        WHERE user_id=p_user_id AND (p_language IS NULL OR language=p_language);
    v_sentence_count:=CASE WHEN v_words_available>0 AND p_limit>=2
        THEN least(v_sentences_available,greatest(1,p_limit/5)) ELSE 0 END;
    v_word_count:=least(v_words_available,p_limit-v_sentence_count);
    v_sentence_count:=least(v_sentences_available,p_limit-v_word_count);
    v_due:=least(v_word_count,(v_review#>>'{meta,counts,due}')::integer);
    -- 仅相同到期日随机打散；到期优先级始终不变，且候选来自完整词库。
    SELECT COALESCE(jsonb_agg(entry ORDER BY due,sample),'[]'::jsonb) INTO v_words FROM (
        SELECT jsonb_build_object('kind','word','word',to_jsonb(w),'state',to_jsonb(s)) AS entry,
            s.due,random() AS sample
        FROM public.words w JOIN public.review_states s ON s.word_id=w.id AND s.user_id=w.user_id
        WHERE w.user_id=p_user_id AND (p_language IS NULL OR w.language=p_language)
        ORDER BY s.due,sample LIMIT v_word_count
    ) picked;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind','sentence','sentence',to_jsonb(picked))),'[]'::jsonb)
    INTO v_sentences FROM (
        SELECT * FROM public.saved_sentences WHERE user_id=p_user_id AND (p_language IS NULL OR language=p_language)
        ORDER BY random() LIMIT v_sentence_count
    ) picked;
    RETURN jsonb_build_object('data',v_words||v_sentences,'meta',jsonb_build_object(
        'available',v_words_available+v_sentences_available,'count',v_word_count+v_sentence_count,
        'words_available',v_words_available,'sentences_available',v_sentences_available,'timezone',v_timezone,
        'selection',jsonb_build_object('due',v_due,'ahead',v_word_count-v_due,'sentences',v_sentence_count)
    ));
END;
$$;

CREATE OR REPLACE FUNCTION public.learning_create_session(p_user_id uuid, p_session jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_words uuid[];
    v_sentences uuid[];
    v_payload jsonb;
    v_session public.practice_sessions%ROWTYPE;
    v_item record;
    v_minutes integer;
BEGIN
    IF p_user_id IS NULL OR p_session IS NULL OR jsonb_typeof(p_session)<>'object'
       OR NOT (p_session ?& ARRAY['id','language','mode'])
       OR (p_session-ARRAY['id','language','mode','topic','word_ids','sentence_ids','target_minutes'])<>'{}'::jsonb
       OR (p_session ? 'word_ids' AND jsonb_typeof(p_session->'word_ids')<>'array')
       OR (p_session ? 'sentence_ids' AND jsonb_typeof(p_session->'sentence_ids')<>'array')
       OR (p_session ? 'topic' AND jsonb_typeof(p_session->'topic')<>'string')
       OR (p_session ? 'target_minutes' AND jsonb_typeof(p_session->'target_minutes')<>'number')
       OR p_session->>'language' IS NULL OR p_session->>'language' NOT IN ('en','de','mixed')
       OR p_session->>'mode' IS NULL OR p_session->>'mode' NOT IN ('conversation','recall','cloze')
       OR char_length(COALESCE(p_session->>'topic',''))>500 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END IF;
    BEGIN
        v_id:=(p_session->>'id')::uuid;
        SELECT COALESCE(array_agg(value::uuid ORDER BY ordinal),'{}'::uuid[]) INTO v_words
            FROM jsonb_array_elements_text(COALESCE(p_session->'word_ids','[]'::jsonb)) WITH ORDINALITY item(value,ordinal);
        SELECT COALESCE(array_agg(value::uuid ORDER BY ordinal),'{}'::uuid[]) INTO v_sentences
            FROM jsonb_array_elements_text(COALESCE(p_session->'sentence_ids','[]'::jsonb)) WITH ORDINALITY item(value,ordinal);
        v_minutes:=COALESCE((p_session->>'target_minutes')::integer,10);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END;
    IF v_id IS NULL OR cardinality(v_words)+cardinality(v_sentences) NOT BETWEEN 1 AND 100
       OR array_position(v_words,NULL) IS NOT NULL OR array_position(v_sentences,NULL) IS NOT NULL
       OR cardinality(v_words)<>(SELECT count(DISTINCT id) FROM unnest(v_words) id)
       OR cardinality(v_sentences)<>(SELECT count(DISTINCT id) FROM unnest(v_sentences) id)
       OR v_minutes NOT BETWEEN 1 AND 60 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_session';
    END IF;
    v_payload:=jsonb_build_object('id',v_id,'language',p_session->>'language','mode',p_session->>'mode',
        'topic',COALESCE(p_session->>'topic',''),'word_ids',to_jsonb(v_words),'sentence_ids',to_jsonb(v_sentences),'target_minutes',v_minutes);
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('session:'||v_id::text,0));
    SELECT * INTO v_session FROM public.practice_sessions WHERE id=v_id;
    IF FOUND THEN
        -- 旧会话创建收据没有 sentence_ids，空数组保持原请求可重试。
        IF v_session.user_id<>p_user_id OR (v_session.initial_payload||jsonb_build_object('sentence_ids',COALESCE(v_session.initial_payload->'sentence_ids','[]'::jsonb)))<>v_payload THEN
            RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='session_id_conflict';
        END IF;
        RETURN to_jsonb(v_session)-'initial_payload';
    END IF;
    FOR v_item IN SELECT * FROM public.words WHERE id=ANY(v_words) ORDER BY id FOR KEY SHARE LOOP
        IF v_item.user_id<>p_user_id OR (p_session->>'language'<>'mixed' AND v_item.language<>p_session->>'language') THEN
            RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_not_found';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.words WHERE id=ANY(v_words) AND user_id=p_user_id)<>cardinality(v_words) THEN
        RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_not_found';
    END IF;
    FOR v_item IN SELECT * FROM public.saved_sentences WHERE id=ANY(v_sentences) ORDER BY id FOR KEY SHARE LOOP
        IF v_item.user_id<>p_user_id OR (p_session->>'language'<>'mixed' AND v_item.language<>p_session->>'language') THEN
            RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='sentence_not_found';
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM public.saved_sentences WHERE id=ANY(v_sentences) AND user_id=p_user_id)<>cardinality(v_sentences) THEN
        RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='sentence_not_found';
    END IF;
    INSERT INTO public.practice_sessions(id,user_id,language,mode,topic,word_ids,sentence_ids,target_minutes,initial_payload)
    VALUES(v_id,p_user_id,p_session->>'language',p_session->>'mode',COALESCE(p_session->>'topic',''),v_words,v_sentences,v_minutes,v_payload)
    RETURNING * INTO v_session;
    RETURN to_jsonb(v_session)-'initial_payload';
END;
$$;

CREATE FUNCTION public.learning_save_word(p_user_id uuid,p_word jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET timezone = 'UTC' AS $$
DECLARE
    v_id uuid;
    v_word public.words%ROWTYPE;
    v_request public.word_write_requests%ROWTYPE;
    v_payload jsonb;
    v_word_text text;
    v_meaning text;
    v_language text;
    v_category text;
    v_date date;
    v_created boolean:=false;
    v_timezone text;
BEGIN
    IF p_user_id IS NULL OR p_word IS NULL OR jsonb_typeof(p_word)<>'object'
       OR NOT (p_word ?& ARRAY['id','word','meaning','language'])
       OR (p_word-ARRAY['id','word','meaning','language','example','example_cn','category','date','etymology'])<>'{}'::jsonb
       OR jsonb_typeof(p_word->'word')<>'string' OR jsonb_typeof(p_word->'meaning')<>'string'
       OR p_word->>'word' IS NULL OR char_length(btrim(p_word->>'word')) NOT BETWEEN 1 AND 200
       OR p_word->>'meaning' IS NULL OR char_length(btrim(p_word->>'meaning')) NOT BETWEEN 1 AND 4000
       OR p_word->>'language' IS NULL OR p_word->>'language' NOT IN ('en','de')
       OR COALESCE(p_word->>'category','') NOT IN ('daily','professional','formal','')
       OR EXISTS (SELECT 1 FROM jsonb_each(p_word) entry WHERE entry.key IN ('example','example_cn','etymology','category','date')
            AND jsonb_typeof(entry.value) NOT IN ('string','null'))
       OR char_length(COALESCE(p_word->>'example',''))>4000 OR char_length(COALESCE(p_word->>'example_cn',''))>4000
       OR char_length(COALESCE(p_word->>'etymology',''))>8000 THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word';
    END IF;
    BEGIN
        v_id:=(p_word->>'id')::uuid;
        IF p_word->>'date' IS NOT NULL THEN
            IF p_word->>'date' !~ '^\d{4}-\d{2}-\d{2}$' THEN
                RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word_date';
            END IF;
            v_date:=(p_word->>'date')::date;
        END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word';
    END;
    IF v_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='PT400', MESSAGE='invalid_word'; END IF;
    v_word_text:=btrim(p_word->>'word'); v_meaning:=btrim(p_word->>'meaning');
    v_language:=p_word->>'language'; v_category:=COALESCE(p_word->>'category','');
    -- 缺省 date 原样记为 null；跨午夜/偏好变更重试仍是同一请求。
    v_payload:=jsonb_build_object('id',v_id,'word',v_word_text,'meaning',v_meaning,'language',v_language,
        'example',COALESCE(p_word->>'example',''),'example_cn',COALESCE(p_word->>'example_cn',''),
        'category',v_category,'date',v_date,'etymology',COALESCE(p_word->>'etymology',''));
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('word-request:'||v_id::text,0));
    SELECT * INTO v_request FROM public.word_write_requests WHERE id=v_id;
    IF FOUND THEN
        IF v_request.user_id<>p_user_id OR v_request.request_payload<>v_payload THEN
            RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='word_request_conflict';
        END IF;
        SELECT * INTO v_word FROM public.words WHERE id=v_request.word_id AND user_id=p_user_id;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='PT404', MESSAGE='word_no_longer_exists'; END IF;
        RETURN jsonb_build_object('word',to_jsonb(v_word),'created',v_request.created,'duplicate',NOT v_request.created,'replayed',true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.words WHERE id=v_id) THEN
        RAISE EXCEPTION USING ERRCODE='PT409', MESSAGE='word_id_conflict';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('word-key:'||p_user_id::text||':'||v_language||':'||lower(v_word_text),0));
    SELECT * INTO v_word FROM public.words WHERE user_id=p_user_id AND language=v_language
        AND lower(btrim(word))=lower(v_word_text) ORDER BY created_at,id LIMIT 1 FOR KEY SHARE;
    IF NOT FOUND THEN
        SELECT COALESCE((SELECT timezone FROM public.learning_preferences WHERE user_id=p_user_id),'Europe/Berlin') INTO v_timezone;
        INSERT INTO public.words(id,user_id,word,meaning,language,example,example_cn,category,date,etymology)
        VALUES(v_id,p_user_id,v_word_text,v_meaning,v_language,p_word->>'example',p_word->>'example_cn',v_category,
            COALESCE(v_date,(now() AT TIME ZONE v_timezone)::date),p_word->>'etymology') RETURNING * INTO v_word;
        v_created:=true;
    END IF;
    INSERT INTO public.word_write_requests(id,user_id,word_id,request_payload,created)
    VALUES(v_id,p_user_id,v_word.id,v_payload,v_created);
    RETURN jsonb_build_object('word',to_jsonb(v_word),'created',v_created,'duplicate',NOT v_created,'replayed',false);
END;
$$;

REVOKE ALL ON FUNCTION public.learning_get_practice_materials(uuid,text,text,integer),public.learning_create_session(uuid,jsonb),
    public.learning_save_word(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.learning_get_practice_materials(uuid,text,text,integer),public.learning_create_session(uuid,jsonb),
    public.learning_save_word(uuid,jsonb) TO service_role;
