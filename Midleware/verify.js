import jwt from 'jsonwebtoken';
import logger from '../winstonown.js';

  const verifyToken = (req, res, next) =>{

    const authHeader = req.headers['authorization'];

    const ip = req.ip;

    if(!authHeader){

      logger.info('Midleware: verify', {ip: ip, success: 'false', message: 'There is no authheader' } );

      return res.status(401).json({ error: "Token error!" });
      
    }

    const token = authHeader.split(' ')[1];

    if (!token) {

      logger.info('Midleware: verify', {ip: ip, success: 'false', message: 'There is no token in the header' } );

      return res.status(401).json({ error: "Token error!" });

    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decodedUser) => {

      if (err) {
        
        logger.info('Midleware: verify', {userId: decodedUser?.userId, ip: ip, success: 'false', message: 'Invalid or expired token!' } );

        return res.status(403).json({ error: "Invalid or expired token!" });

      }

      if(!decodedUser){

        return res.status(401).json({ error: "Token error!" });
        
      }
      req.user = decodedUser;

      
      
      next();

    });

  }

  export default {verifyToken}