import jwt from 'jsonwebtoken';
import express from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import cloudToken from '../Midleware/cloud.js';
import validator from '../Midleware/validator.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import { prisma } from '../database.js';
import logger from '../winstonown.js';
const router = express.Router();

const regSchema = z.object({

  email: z.email({ error: 'Invalid email format' }),

  username: z.string().optional(),

  password: z.string()

    .min(8, 'Password must be at least 8 characters long!')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter!')
    .regex(/\d/, 'Must contain at least one number!')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character!'),

  passwordAgain: z.string(), 

}).refine((data) => data.password === data.passwordAgain, {

  message: "Passwords don't match!",
  path: ['passwordAgain'], 

});

const registerLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 15 * 60,
    maxAttempts: 10,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const regValidator = validator.createValidator({

    Schema: regSchema

});

const strictJsonLimit = express.json({ limit: '5kb' });


router.post('/api/register', strictJsonLimit, cloudToken.verifyRobotOrToken, registerLimiter, regValidator, async (req, res)  => {

    const ip = req.ip;

    try{
        const {userName, email, password } = req.body;

        const saltRounds = 10;
        
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        let id = null;

        await prisma.$transaction(async (tx) => {
    
            const newUser = await tx.users.create( { data: {email: email, username: userName, password: hashedPassword} } );

            await tx.subscriptions.create( {data: {user_id: newUser.id} } );
    
            id = newUser.id;

        })

        const token = jwt.sign(
            { userId: id, userName: userName }, 
            process.env.JWT_SECRET,                             
            { expiresIn: '3600s' }                    
        );

        const refreshToken = jwt.sign(
            { userId: id }, 
            process.env.JWT_SECRET_REFRESH,                             
            { expiresIn: '7d' }                    
        );
        
        await prisma.users.update( {where: {id: id}, data: {refresh_token: refreshToken}} )

        logger.info('/api/register', {userId: id, ip: ip, success: 'true'} );

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 nap
        });

        return res.status(200).json({

            message: 'success', 
            token: token,

        })


    }catch(err){

        logger.error('/api/register', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code,
                errno: err.errno
            },
            ip: ip,
            requestId: req.id
        });

        const failedField = err.meta?.target;

        if(failedField?.includes('username')){

            return res.status(401).json({error: 'This username is already taken. Please choose another one.'});

        }

        if(failedField?.includes('email')){

            return res.status(401).json({error: 'An account with this email already exists. Please log in instead.'});
       
         
        }

        return res.status(500).json({error: 'An unexpected error occurred. Please try again later.'})

    }


});

export default router;