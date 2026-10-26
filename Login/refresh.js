import jwt from 'jsonwebtoken';
import express from 'express';
import rateLimiter from '../Midleware/rateLimiter.js';
import verify from '../Midleware/verify.js';
import { prisma } from '../database.js';
const router = express.Router();

const refresh = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 120,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const strictJsonLimit = express.json({ limit: '5kb' });


router.post('/api/auth/refresh', strictJsonLimit, refresh, async (req, res) => {

  const token = req.cookies?.refreshToken;

  if (!token){

    return res.status(401).json({ error: 'There is no refresh token' });

  } 

  try{

    const decoded = jwt.verify(token, process.env.JWT_SECRET_REFRESH);

    const result = await prisma.users.findUnique( { where: {id:decoded.userId }} )

    if(!result){

      return res.status(403).json({ error: 'Revoked token' });

    }

    const refresh_token = result.refresh_token;

    if (!refresh_token){

      return res.status(403).json({ error: 'Revoked token' });

    }

    const newAccessToken = jwt.sign(
      { userId: decoded.userId }, 
      process.env.JWT_SECRET, 
      { expiresIn: '60m' }
    );

    res.json({ accessToken: newAccessToken });

  }catch(err){

    console.log(err)

    res.status(500).json({message: 'Invalid refresh token'});


  }
});


router.post('/api/auth/logout', strictJsonLimit, verify.verifyToken, refresh, async (req, res) => {

  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    try {

   
      const userId = req.user.userId;

      if (userId) {

        await prisma.users.update( {where: {id: userId}, data: { refresh_token: null }} )

      }
    } catch (err) {

      console.error('Hiba a refresh token dekódolásakor:', err);
      return
    }
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });


  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', 
  });

  return res.status(200).json({ message: 'Sikeres kijelentkezés' });
});

export default router;