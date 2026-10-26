import express from 'express';
import { z } from 'zod';
import verify from '../Midleware/verify.js';
import emailsend from './email.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import validator from '../Midleware/validator.js';
import logger from '../winstonown.js';
import crypto from 'node:crypto';
import { prisma } from '../database.js';

const router = express.Router();

const emailSchema = z.object({

    email: z.email({error: 'Invalid email format'}),
    

});

const updateLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 5,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const updateValidator = validator.createValidator({

    Schema: emailSchema

});

const strictJsonLimit = express.json({ limit: '5kb' });

router.put('/api/updateEmail', strictJsonLimit, verify.verifyToken, updateLimiter, updateValidator, async (req, res)  => {

    const userId = req.user?.userId;
    const ip = req.ip;
    const email_from_frontend = req.body?.email;

    try{

        const { email } = await prisma.users.findFirst({where: {id: userId}});

        if(email === email_from_frontend){

            logger.info('/api/updateEmail', {userId: userId, ip: ip, success: 'false', message: 'This email address is already in use.' } );

            logger.info('/api/updateEmail', {userId: userId, ip: ip, success: 'false', message: 'This email address is already in use.',
                productionOnly: true,  email_in_database: email, email_from_frontend: email_from_frontend
             } );

            return res.status(409).json({ 

                error: `This email address is already in use.` 

            });

        }

        const code = crypto.randomInt(100000, 1000000);
        const expiresAt = Date.now() + 10 * 60 * 1000;

        await prisma.users.update( { where: {id: userId}, data: { emailCode: code, emailCodeExpiry: expiresAt } } )

        await emailsend.sendEmailChangeCode(email, code);

        await prisma.users.update( { where: {id: userId }, data: { newemail: email_from_frontend } } )

        logger.info('/api/updateEmail', {userId: userId, ip: ip, success: 'true'} );

        logger.info('/api/updateEmail', {userId: userId, ip: ip, success: 'true', productionOnly: true, emailCode: code, emailCodeExpiry: expiresAt,
            email_in_database: email, newemail: email_from_frontend
         } );

        return res.json({ success: true, message: 'Verification code sent to your new email.' });

    }catch(err){
  
        logger.error('/api/updateEmail', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({ error: 'Failed to send email.' });
    }

})

router.put('/api/updateEmailConfirm', strictJsonLimit, verify.verifyToken, updateLimiter, async (req, res)  => {

    const userId = req.user?.userId;
    const ip = req.ip;

    try{

        const { code } = req.body;

        const { emailCode, emailCodeExpiry, newemail}= await prisma.users.findFirst( { where: { id: userId} } );

        if(Number(emailCode) !== Number(code) || Date.now() > emailCodeExpiry){

            logger.info('/api/updateEmailConfirm', {userId: userId, ip: ip, success: 'false', message: 'Verification code error.'} );

            logger.info('/api/updateEmailConfirm', {userId: userId, ip: ip, success: 'false', message: 'Verification code error.', productionOnly: true,
                code: code, emailCode:emailCode, emailCodeExpiry: emailCodeExpiry, newemail: newemail, now: Date.now()
            } );

            return res.status(400).json({ error: 'Verification code error.' });

        }
        
        await prisma.users.update( { where: { id: userId}, data: {email: newemail}} )

        logger.info('/api/updateEmailConfirm', {userId: userId, ip: ip, success: 'true'} );

        logger.info('/api/updateEmailConfirm', {userId: userId, ip: ip, success: 'true', productionOnly: true, newemail: newemail} );

        res.status(200).json({ success: true, message: 'Email changed' });

    }catch(err){

        logger.error('/api/updateEmailConfirm', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({ error: 'Unexpected error' });
    }

})


export default router;