import express from 'express';
import { z } from 'zod';
import verify from '../Midleware/verify.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import validator from '../Midleware/validator.js';
import logger from '../winstonown.js';

import { prisma } from '../database.js';

const router = express.Router();

const userSchema = z.object({

    username: z.string().min(1, 'Username is required!'),
    
});

const updateLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 5,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const updateValidator = validator.createValidator({

    Schema: userSchema

});

const strictJsonLimit = express.json({ limit: '5kb' });

router.put('/api/updateUsername', strictJsonLimit, verify.verifyToken, updateLimiter, updateValidator, async (req, res)  => {

    const username = req.body?.username;
    const userId = req.user?.userId;
    const ip = req.ip;

    try{

        await prisma.users.update({where: {id: userId}, data: { username: username}});

        logger.info('/api/updateUsername', { userId: userId, success: 'succes', ip: ip }); 

        logger.info('/api/updateUsername', { userId: userId, success: 'succes', ip: ip, productionOnly: true, username: username });

        return res.status(200).json({ message: "Saved!",});

    }catch(err){

        logger.error('/api/updateUsername', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code,
                errno: err.errno
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({ error: 'Unexpected error' });
        
    }

})


export default router;