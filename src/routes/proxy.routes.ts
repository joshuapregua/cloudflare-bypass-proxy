import { Router, Request, Response } from 'express';
import { puppeteerService } from '../services/puppeteer.service';
import { config } from '../config';
import { logger } from '../logger';

const router: Router = Router();

// Optional API key middleware
const authMiddleware = (req: Request, res: Response, next: Function) => {
    if (config.API_KEY) {
        const apiKey = req.headers['x-api-key'];
        if (apiKey !== config.API_KEY) {
            return res.status(401).json({ success: false, error: 'Unauthorized' });
        }
    }
    next();
};

router.use(authMiddleware);

/**
 * GraphQL proxy endpoint (optimized for Stake-like APIs)
 * POST /api/proxy/graphql
 * Body: { url: string, query: string, variables?: object, operationName?: string }
 */
router.post('/graphql', async (req: Request, res: Response) => {
    const { url, query, variables, operationName } = req.body;

    if (!url || !query) {
        return res.status(400).json({ success: false, error: 'URL and query are required' });
    }

    logger.info({ url, operationName }, 'GraphQL proxy request');

    const result = await puppeteerService.graphqlRequest({
        url,
        query,
        variables,
        operationName,
    });

    res.status(result.success ? 200 : 500).json(result);
});

/**
 * Stake-specific endpoint (convenience wrapper)
 * POST /api/proxy/stake/bet
 * Body: { betId: string }
 */
router.post('/stake/bet', async (req: Request, res: Response) => {
    const { betId } = req.body;

    if (!betId) {
        return res.status(400).json({ success: false, error: 'betId is required' });
    }

    const query = `
        query LimboPreview($iid: String!) {
            bet(iid: $iid) {
                id
                iid
                bet {
                    ... on CasinoBet {
                        ...CasinoBet
                        state {
                            ...CasinoGameLimbo
                            __typename
                        }
                        __typename
                    }
                    __typename
                }
                __typename
            }
        }

        fragment CasinoBet on CasinoBet {
            id
            active
            payoutMultiplier
            amountMultiplier
            amount
            payout
            updatedAt
            currency
            game
            user {
                id
                name
                __typename
            }
        }

        fragment CasinoGameLimbo on CasinoGameLimbo {
            result
            multiplierTarget
        }
    `;

    logger.info({ betId }, 'Stake bet lookup request');

    const result = await puppeteerService.graphqlRequest({
        url: 'https://stake.ac/_api/graphql',
        query,
        variables: { iid: betId },
        operationName: 'LimboPreview',
    });

    res.status(result.success ? 200 : 500).json(result);
});

export { router as proxyRouter };
