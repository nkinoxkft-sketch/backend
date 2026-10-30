import axios from "axios";
import logger from "../winstonown.js";

const verifyRobotOrToken = async (req, res, next) =>{

    const userId = req.user?.userId;
    const ip = req.ip;
    const cloud = req.body?.cloud;

    const secretKey = process.env.CLOUD_FLARE_SECRET; 
    
    const verificationUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    const payload = { secret: secretKey, response: cloud }

    if (!cloud) {

        logger.info('Midleware: cloudflare', {userId: userId, ip: ip, success: 'false', message: 'Missing verification token.'} );

        return res.status(400).json({ error: 'Missing verification token.' });

    }

    try{

        const response = await axios.post(verificationUrl, payload, {

            headers: { 'Content-Type': 'application/json' },

        })

        if (!response.data.success) {

            logger.info('Midleware: cloudflare', {userId: userId, ip: ip, success: 'false', message: 'Robot verification failed. Please try again.'} );

            return res.status(403).json({

                error: 'Robot verification failed. Please try again.',

            });

        }


    }catch(err){

        logger.error('Midleware: cloudflare', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code
            },
            userId: userId,
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({ error: 'Unexpected error.', });

    }


    next();

    
}



export default {verifyRobotOrToken}