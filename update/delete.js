import express from 'express';
const router = express.Router();
import verify from '../Midleware/verify.js';
import logger from '../winstonown.js';
import emailsend from './email.js';
import crypto from 'node:crypto';
import { cancelSubscription } from '../Payment/payment.js';
import { prisma } from '../database.js';
import rateLimiter from '../Midleware/rateLimiter.js';

const deleteLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 2,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const strictJsonLimit = express.json({ limit: '5kb' });

router.put('/api/delete', strictJsonLimit, verify.verifyToken, deleteLimiter, async (req, res) => {

    const userId = req.user?.userId;
    const ip = req.ip;

    try{

        const code = crypto.randomInt(100000, 1000000);
        const expiry = Date.now() + 10 * 60 * 1000;

        await prisma.users.update( {where: { id: userId}, data: { emailCode: code, emailCodeExpiry: expiry} } )
        
        const { email } = await prisma.users.findFirst( { where: { id: userId}});
    
        await emailsend.sendCode(email, code);

        logger.info('/api/delete', {userId: userId, ip: ip, success: 'true', message: 'Code sent'} );

        logger.info('/api/delete', {userId: userId, ip: ip, success: 'true', message: 'Code sent', productionOnly: true, emailCode: code, emailCodeExpiry: expiry, email: email} );

        return res.json({ success: true, message: 'Verification code sent to your new email.' });

    }catch(err){

        
        logger.error('/api/delete', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({error: 'Unexpected error'})
        

    }
    
})


router.delete('/api/deleteConfirm', strictJsonLimit, verify.verifyToken, deleteLimiter, async (req, res) => {

    const userId = req.user?.userId;
    const ip = req.ip;

    try{

        const { code } = req.body;

        const { emailCode, emailCodeExpiry } = await prisma.users.findFirst({ where: {id: userId}});


        if(Date.now() > emailCodeExpiry || Number(emailCode) !== Number(code)) {

            logger.info('/api/deleteConfirm', {userId: userId, ip: ip, success: 'false', message: 'Verification code wrong.'} );

            logger.info('/api/deleteConfirm', {userId: userId, ip: ip, success: 'false', message: 'Verification code wrong.', productionOnly: true,
                code_expiry: emailCodeExpiry, now: Date.now(), code_in_database: emailCode, code: code
            } );

            return res.status(400).json({ error: 'Verification code wrong.' });

        }

        const { sub_id } = await prisma.subscriptions.findFirst( { where: { user_id: userId }} );

        if(sub_id){

            await cancelSubscription(sub_id);

        }

        await prisma.users.delete( { where: { id: userId } } );

        logger.info('/api/deleteConfirm', {userId: userId, ip: ip, success: 'true'} );

        res.status(200).json({message: 'Success'})


    }catch(err){

        logger.error('/api/deleteConfirm', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({error: 'Unexpected error'})
        

    }


})


export default router;