import redis from '../redishconfig.js';
import logger from '../winstonown.js';


const createRateLimiter = ({ windowSeconds, maxAttempts, setting }) => {

    return async (req, res, next) => {

        const userId = req.user?.userId;
        const ip = req.ip;

        try {
            
            const path = req.path;

            const limiterKey = `${path}:${ip}:${userId}`;

            const currentAttempts = await redis.incr(limiterKey);

            let ttl = await redis.ttl(limiterKey);

            if (currentAttempts === 1 || ttl === -1) {
                await redis.expire(limiterKey, windowSeconds);
                ttl = windowSeconds;
            }

            if (currentAttempts === 1) {

                await redis.expire(limiterKey, windowSeconds);

            }
            
            if (currentAttempts >= maxAttempts) {
        
                //const ttl = await redis.ttl(limiterKey);

                console.log(currentAttempts, ttl)
        
                res.set('Retry-After', String(ttl));

                logger.info('Midleware: rateLimiter', {userId: userId, ip: ip, success: 'false', maxAttempts: maxAttempts, currentAttempts: currentAttempts, message: `Too many requests. Try again in ${Math.ceil(ttl / 60)} minutes.`} );

                return res.status(429).json({  error: `Too many requests. Try again in ${Math.ceil(ttl / 60)} minutes.` });
        
            }

            req.rateLimiter = {

                key: limiterKey,

                async reset() {
                    await redis.del(limiterKey);
                },

            };

            next(); 

        } catch (err) {

            logger.error('Midleware: rateLimiter', {
                error: {
                    message: err.message,
                    stack: err.stack,
                    code: err.code
                },
                userId: userId,
                ip: ip,
                requestId: req.id
            });

            return res.status(500).json({ error: `Unexpected error.` });

        }
    };
};

export default {createRateLimiter}