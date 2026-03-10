import { config } from '../config';
import { logger } from '../logger';

interface FlareSolverrRequest {
    cmd: 'request.get' | 'request.post';
    url: string;
    maxTimeout?: number;
    postData?: string;
    headers?: Record<string, string>;
}

interface FlareSolverrResponse {
    status: string;
    message: string;
    startTimestamp: number;
    endTimestamp: number;
    version: string;
    solution: {
        url: string;
        status: number;
        headers: Record<string, string>;
        response: string;
        cookies: Array<{
            name: string;
            value: string;
            domain: string;
            path: string;
            expires: number;
            httpOnly: boolean;
            secure: boolean;
            sameSite: string;
        }>;
        userAgent: string;
    };
}

export interface ProxyRequest {
    url: string;
    method: 'GET' | 'POST';
    body?: unknown;
    headers?: Record<string, string>;
    timeout?: number;
}

export interface ProxyResponse {
    success: boolean;
    status?: number;
    data?: unknown;
    error?: string;
    timing?: {
        startTimestamp: number;
        endTimestamp: number;
        duration: number;
    };
}

export class FlareSolverrService {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = config.FLARESOLVERR_URL;
    }

    async makeRequest(request: ProxyRequest): Promise<ProxyResponse> {
        const startTime = Date.now();

        try {
            const flareRequest: FlareSolverrRequest = {
                cmd: request.method === 'POST' ? 'request.post' : 'request.get',
                url: request.url,
                maxTimeout: request.timeout || config.REQUEST_TIMEOUT,
            };

            // For POST requests, stringify the body
            if (request.method === 'POST' && request.body) {
                flareRequest.postData = JSON.stringify(request.body);
            }

            if (request.headers) {
                flareRequest.headers = request.headers;
            }

            logger.info({ url: request.url, method: request.method }, 'Sending request to FlareSolverr');

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(flareRequest),
                signal: AbortSignal.timeout(config.MAX_TIMEOUT),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error({ status: response.status, error: errorText }, 'FlareSolverr request failed');
                return {
                    success: false,
                    error: `FlareSolverr error: ${response.status}`,
                };
            }

            const flareResponse = (await response.json()) as FlareSolverrResponse;

            if (flareResponse.status !== 'ok') {
                logger.error({ message: flareResponse.message }, 'FlareSolverr returned error status');
                return {
                    success: false,
                    error: flareResponse.message,
                };
            }

            // Parse the response if it's JSON
            let data: unknown;
            try {
                data = JSON.parse(flareResponse.solution.response);
            } catch {
                // Response is not JSON, return as string
                data = flareResponse.solution.response;
            }

            const endTime = Date.now();

            return {
                success: true,
                status: flareResponse.solution.status,
                data,
                timing: {
                    startTimestamp: flareResponse.startTimestamp,
                    endTimestamp: flareResponse.endTimestamp,
                    duration: endTime - startTime,
                },
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ error: errorMessage, url: request.url }, 'FlareSolverr request exception');

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Specialized method for GraphQL requests (like Stake API)
     */
    async graphqlRequest(
        url: string,
        query: string,
        variables?: Record<string, unknown>,
        operationName?: string
    ): Promise<ProxyResponse> {
        // Extract origin from URL for proper CORS headers
        const urlObj = new URL(url);
        const origin = urlObj.origin;

        return this.makeRequest({
            url,
            method: 'POST',
            body: {
                query,
                variables,
                operationName,
            },
            headers: {
                'Content-Type': 'application/json',
                'x-apollo-operation-name': operationName || 'GraphQLQuery',
                'apollo-require-preflight': 'true',
                'Origin': origin,
                'Referer': `${origin}/`,
            },
        });
    }
}

export const flareSolverrService = new FlareSolverrService();
