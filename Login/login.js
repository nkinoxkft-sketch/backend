import jwt from 'jsonwebtoken';
import express from 'express';
import { z } from 'zod';
import cloudToken from '../Midleware/cloud.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import validator from '../Midleware/validator.js';
import axios from 'axios';
import { serverLog } from '../serverlog.js';
import bcrypt from 'bcrypt';
import logger from '../winstonown.js';
import { prisma } from '../database.js';

const serverlog = serverLog('login')
const router = express.Router();

const loginSchema = z.object({

    email: z.email({ error: 'Invalid email format' }),
    
    password: z.string().min(1, {error: 'Incorrect email or password. Please try again.'} )

});

const loginLimiter = rateLimiter.createRateLimiter({
    windowSeconds: 15 * 60,
    maxAttempts: 15,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const loginValidator = validator.createValidator({

    Schema: loginSchema

});

const strictJsonLimit = express.json({ limit: '5kb' });


router.post('/api/login', strictJsonLimit, cloudToken.verifyRobotOrToken, loginLimiter, loginValidator, async (req, res)  => {

    const ip = req.ip;

    try{

        const { email, password } = req.body;

        serverlog.log('login', `Email: ${email} \n`)

        const result = await prisma.users.findUnique( { where: { email: email} }  )


        logger.info('/api/login', {email: email, ip: ip, result: result} );
        
        if(!result){

            const dummyHash = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
            
            await bcrypt.compare(password, dummyHash);

            serverlog.log('login', '-------------Server log login end incorrect password------------- \n')

            return res.status(401).json({

                error: "Incorrect email or password. Please try again."

            });

        }

        const { id: user_id, username, password: pass_in_databse} = result;

        let isValid = false; 


        if(pass_in_databse){

            isValid = await bcrypt.compare(password, pass_in_databse);

        }

        logger.info('/api/login', {email: email, ip: ip,  isValid: isValid} );

        if(!isValid){

            const dummyHash = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
            
            await bcrypt.compare(password, dummyHash);

            serverlog.log('login', '-------------Server log login end incorrect password------------- \n')

            return res.status(401).json({

                error: "Incorrect email or password. Please try again."

            });
            
        }

        const token = jwt.sign(
            { userId: user_id, userName: username }, 
            process.env.JWT_SECRET,                             
            { expiresIn: '1800' }                    
        );

        const refreshToken = jwt.sign(
            { userId: user_id }, 
            process.env.JWT_SECRET_REFRESH,                             
            { expiresIn: '7d' }                    
        );

        await prisma.users.update( { where: {id: user_id}, data: {refresh_token: refreshToken} } )

        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 nap
        });

        return res.status(200).json({

            message: "Successfull login", 
            token: token,

        })

    }catch(err){

        logger.error('/api/login', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code,
            },
            ip: ip,
            requestId: req.id
        });

        return res.status(500).json({error: 'An unexpected error occurred. Please try again later.'});

    }


});

router.post('/api/google-login', strictJsonLimit, loginLimiter, async (req, res) => {

    const ip = req.ip;

    try {

        serverlog.log('login with google', `-------------Server log login with google------------- \n`)


        const { token } = req.body;

        const googleResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {

            headers: {
                Authorization: `Bearer ${token}`
            }
            
        });

        const { email, name, sub } = googleResponse.data;

        serverlog.log('login with google', `From google email: ${email}, name: ${name}, sub: ${sub} \n`)

        const googleId = sub

        const result = await prisma.users.findUnique({ where: { email: email} });

        let { id, username: username_database, email: email_database, googleid: googleid_from_database} = result || {};

        serverlog.log('login with google', `From databse id: ${id}, username: ${username_database}, email: ${email_database} \n`)

        if (!id) {

            serverlog.log('login with google', `-------------Server log login create account with google------------- \n`)

            username_database = name;
            email_database = email;

            await prisma.$transaction(async (tx) => {

                const newUser = await tx.users.create( { data: {email: email, username: name, googleid: googleId} } );

                await tx.subscriptions.create( {data: {user_id: newUser.id} } );

                id = newUser.id;

            })



            serverlog.log('login with google', `id: ${id}, username: ${username_database}, email: ${email_database} \n`)

        }
        else if(id && !googleid_from_database){

            serverlog.log('login with google', `-------------Server log login connect google account------------- \n`)

            await prisma.users.update( { where: { email: email}, data: { googleid:  googleId} } );

        }

        serverlog.log('login with google', `id: ${id}, username: ${username_database}, email: ${email_database} \n`)


        const appToken = jwt.sign(
            { userId: id, userName: username_database }, 
            process.env.JWT_SECRET,                        
            { expiresIn: '1800s' }                    
        );

        const refreshToken = jwt.sign(
            { userId: id }, 
            process.env.JWT_SECRET_REFRESH,                             
            { expiresIn: '7d' }                    
        );

        await prisma.users.update( { where: {id: id}, data: {refresh_token: refreshToken}} )
        console.log(process.env.NODE_ENV === 'production', process.env.NODE_ENV)
        res.cookie('refreshToken', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 nap
        });

        res.status(200).json({
            message: "Successful Google login",
            token: appToken,
        });

    } catch (err) {

        logger.error('/api/google-login', {
            error: {
                message: err.message,
                stack: err.stack,
                code: err.code,
            },
            ip: ip,
            requestId: req.id
        });

        res.status(401).json({ error: "Google authentication failed." });
    }
});

export default router;

   