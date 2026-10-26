import express from 'express';
import verify from '../Midleware/verify.js';
import logger from '../winstonown.js';
import rateLimiter from '../Midleware/rateLimiter.js';
import { prisma } from '../database.js';
const router = express.Router();

const limiter = rateLimiter.createRateLimiter({
    windowSeconds: 1 * 60,
    maxAttempts: 30,
    message: 'Too many failed attempts. You are locked out for 15 minutes.'
});

const strictJsonLimit = express.json({ limit: '5kb' });

router.get('/api/getSubData', strictJsonLimit, verify.verifyToken, limiter, async (req, res) => {

  const userId = req.user?.userId;
  const ip = req.ip;
  const requestId = req.id;

  try{
    
    await checkSubStatus(userId);

    const { subscription_status, subscription_expiry, remaining_credits, nextPlan } = await prisma.subscriptions.findFirst({ where: {user_id: userId} })

    logger.info('/api/getSubData', {userId: userId, ip: ip, requestId: requestId, subscription_status: subscription_status, expiry: subscription_expiry, credits: remaining_credits, nextPlan: nextPlan, productionOnly: true} );

    res.status(200).json({ 

      subData: {status: subscription_status, expiry: subscription_expiry, messages: remaining_credits, nextPlan: nextPlan},
    
    });

  }catch(err){

    logger.error('/api/getSubData', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      userId: userId,
      ip: ip,
      requestId: requestId
    });

    res.status(500).json({error: 'An unexpected error occurred. Please try again later.'});

  }
  
});


export const checkSubStatus = async (userId) => {

  const result = await prisma.subscriptions.findFirst({
    where: {
        user_id: userId,
        subscription_expiry: { 
            gt: Date.now() 
        }
    },
    select: {

      id: true

    }
  });

  return !!result;

}


export default router;