import { handleRequest } from '../server/api';
import { normalizeApiRequest } from '../server/routing';

export default { fetch: (request: Request) => handleRequest(normalizeApiRequest(request)) };
