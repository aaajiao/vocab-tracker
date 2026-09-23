import { handleRequest } from '../server/api.js';
import { normalizeApiRequest } from '../server/routing.js';

export default { fetch: (request: Request) => handleRequest(normalizeApiRequest(request)) };
