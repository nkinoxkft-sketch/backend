import express from 'express';
import database from './AiDataBase.js';
import verify from '../Midleware/verify.js';
import { getDownloadUrl } from './filefunctions.js';
import logger from '../winstonown.js';
import limiterimport from '../Midleware/rateLimiter.js'
import { checkSubStatus } from '../Subscription/subData.js';
import { prisma } from '../database.js';
import { z } from 'zod' 
import validator from '../Midleware/validator.js';

const router = express.Router();

const limiter = limiterimport.createRateLimiter({

  windowSeconds: 1 * 60,
  maxAttempts: 60,
  message: 'Too many failed attempts. You are locked out for 1 minutes.'

})

const strictJsonLimit = express.json({ limit: '5kb' });


router.get('/api/getSessions', strictJsonLimit, verify.verifyToken, limiter, async (req, res) => {

  const userId = req.user?.userId;
  const ip = req.ip;
  const requestId = req.id;
  const limit = req.query?.limit;

  try{
    
    const valid = await checkSubStatus(userId);

    if(!valid){

      logger.error('/api/getSessions', { error: 'No valid subscription or not enough credit.', userId: userId, ip: ip, requestId: requestId } );

      return res.status(403).json({ error: 'No valid subscription or not enough credit.' });

    }

    const takeAmount = 20;
    const parsedLimit = Number.parseInt(limit) || takeAmount;
    const offset = Math.max(0, parsedLimit - takeAmount); 

    const reply = await prisma.session.findMany({ where: {user_id: userId}, select: { id: true, session_crypted: true, session_placeholder: true}, orderBy: { updated_at: 'desc'}, take: takeAmount, skip: offset });

    logger.info('/api/getSessions', { message: "reply sessions generated", userId: userId, ip: ip, requestId: requestId, sessions_lenght: reply.length  } );

    res.status(200).json({  

      sessions: reply
    
    });

  }catch(err){

    logger.error('/api/getSessions', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      userId: userId,
      ip: ip,
      requestId: req.id
    });

    res.status(500).json({ error: "Unexpected error" });

  }

  
});

const messageSchema = z.object({

    session_id: z.string({ message: 'Session_id must be a string' })
    .max(250, { message: 'Session_id cannot exceed 250 characters' }),


    limit: z.coerce.number({ message: 'limit must be a number' })
   
});


const messageValidator = validator.createValidator({

    Schema: messageSchema,
    target: 'query'

});

router.get('/api/getMessages', strictJsonLimit, verify.verifyToken, limiter, messageValidator, async (req, res) => {

  const session_id = req.query?.session_id;
  const limit = req.query?.limit;
  const userId = req.user?.userId
  const requestId = req.id;
  const ip = req.ip;
 
  try{
 
    const prompts = await database.getMessagesByOffset(session_id, limit);
   
    const reply_promises = prompts.map( async (prompt) => {

      const prepareFilestoDownload = prompt.files.map( async (key) => {

        return getDownloadUrl(key);

      })

      const downloadedFiles = await Promise.all(prepareFilestoDownload);

      return {

        promt: prompt.promt,
        answare: prompt.answare,
        file: downloadedFiles,

      }

    })

    const reply = await Promise.all(reply_promises);

    logger.info('/api/getMessages', { message: 'reply prompts generated', prompts_lenth: reply.length, userId: userId, ip: ip, requestId: requestId} );

    res.status(200).json({ 

      messages: reply,
    
    });

  }catch(err){

    logger.error('/api/getMessages', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      ip: ip,
      requestId: requestId,
      userId: userId
    });

    res.status(500).json({ error: "Unexpected error" });

  }

});

router.get('/api/getInstruction', strictJsonLimit, verify.verifyToken, limiter, async (req, res) => {

  const userId = req.user?.userId
  const requestId = req.id;
  const ip = req.ip;

  try{

    const result = await prisma.users.findUnique( {where: {id: userId}} )

    if(!result){

      logger.error('/api/getInstruction', { error: 'User no longer exists. Please log in again.', userId: userId, ip: ip, requestId: requestId} );

      return res.status(401).json({ error: 'User no longer exists. Please log in again.' });

    }
    
    logger.info('/api/getInstruction', { message: 'instruction selected', userId: userId, ip: ip, requestId: requestId} );

    res.status(200).json({ 

      instruction: result.instruction,
    
    });


  }catch(err){

    logger.error('/api/getInstruction', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      ip: ip,
      requestId: requestId,
      userId: userId
    });

    res.status(500).json({ error: "Unexpected error" });

  }

  
});

const instructionSchema = z.object({

  instruct: z.string({ message: 'Instruct must be a string' })
  .max(5000, { message: 'Instruct cannot exceed 5000 characters' })
   
});


const instructionValidator = validator.createValidator({

    Schema: instructionSchema

});

const strictJsonLimitInt = express.json({ limit: '1mb' });

router.post('/api/setInstruction', strictJsonLimitInt, verify.verifyToken, limiter, instructionValidator, async (req, res) => {

  const userId = req.user?.userId
  const requestId = req.id;
  const ip = req.ip;
  const instruct = req.body.instruction || null

  try{

    if(!instruct){

      logger.error('/api/setInstruction', { error: 'Bad request', userId: userId, ip: ip, requestId: requestId} );

      return res.status(400).json({ error: 'Bad request' });

    }

    await prisma.users.update( {where: {id: userId}, data: { instruction: instruct} })

    logger.info('/api/setInstruction', { message: 'instruction changed', userId: userId, ip: ip, requestId: requestId} );


    res.status(200).json({ success: true });

  }catch(err){

    logger.error('/api/setInstruction', {
      error: {
          message: err.message,
          stack: err.stack,
          code: err.code
      },
      ip: ip,
      requestId: requestId,
      userId: userId
    });

    res.status(500).json({ error: "Unexpected error" });

  }

  
});

export default router;