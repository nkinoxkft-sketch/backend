import { z } from 'zod';
import logger from "../winstonown.js";


const createValidator = ({ Schema, target = 'body' }) => {

    return async (req, res, next) => {

        const userId = req.user?.userId;
        const ip = req.ip;

        try {
            
            const validationResult = Schema.safeParse(req[target]);

            if (!validationResult.success) {
                const formattedErrors = z.treeifyError(validationResult.error);
                
                logger.info('Midleware: validator', {userId: userId, ip: ip, success: 'false', error: formattedErrors } );

                return res.status(400).json({ error: formattedErrors,});
                    
            }

            next(); 

        } catch (err) {

            logger.error('Midleware: validator', {
                error: {
                    message: err.message,
                    stack: err.stack,
                    code: err.code
                },
                userId: userId,
                ip: ip,
                requestId: req.id
            });

            return res.status(500).json({error: "Unexpected server eror",});
            
        }
    };
};

export default {createValidator}