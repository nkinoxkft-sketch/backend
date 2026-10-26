import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_EMAIL);

const sendPasswordResetEmail = async (userEmail, resetToken) => {
  const resetLink = ` https://curly-acorn-shank.ngrok-free.dev/reset-password?token=${resetToken}`;

  const { data, error } = await resend.emails.send({
    from: 'Claudify <onboarding@resend.dev>', // Érdemes az 'Appod Neve' helyett a végleges nevet használni
    to: userEmail,
    subject: 'Reset Your Claudify Password',
    html: `
      <div style="background-color: #f3f4f6; padding: 60px 20px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        
        <h2 style="font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; font-weight: normal; font-size: 28px; margin-bottom: 15px;">
          Reset Your Password
        </h2>
        
        <p style="color: #555555; font-size: 16px; line-height: 1.6; max-width: 450px; margin: 0 auto 30px auto;">
          You recently requested to reset your password for your Claudify account. Click the button below to securely set up a new one.
        </p>
        
        <a href="${resetLink}" style="display: inline-block; padding: 14px 28px; background-color: #1C1C1C; color: #ffffff; text-decoration: none; border-radius: 4px; font-weight: 500; font-size: 15px;">
          Reset Password
        </a>
        
        <p style="color: #888888; font-size: 13px; margin-top: 40px; line-height: 1.5;">
          If you didn't request a password reset, you can safely ignore this email.<br>Your current password will remain unchanged.
        </p>

      </div>
    `
  });

  if (error) {
    console.error('Hiba a Resend küldésekor:', error);
    return false;
  }

  console.log('Email sikeresen elküldve. Resend ID:', data.id);
  return true;
}


const sendEmailChangeCode = async (userEmail, code) => {
 

 const { data, error } = await resend.emails.send({
  from: 'Claudify <onboarding@resend.dev>', 
  to: userEmail,
  subject: 'Verify Your New Email Address',
  html: `
  <div style="background-color: #f9fafb; padding: 60px 20px; text-align: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    
    <!-- Email Kártya -->
    <div style="max-width: 440px; margin: 0 auto; background-color: #ffffff; padding: 40px 32px; border-radius: 12px; border: 1px solid #f3f4f6; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04);">
      
      <h2 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0 0 12px 0;">
        Email Address Change
      </h2>
      
      <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0;">
        You requested to change the email address associated with your <strong>Claudify</strong> account. Please use the verification code below to complete the process.
      </p>
      
      <!-- Kód blokk (A gombjaid stílusához igazítva) -->
      <div style="display: inline-block; background-color: #1a1a1a; color: #ffffff; border-radius: 8px; padding: 16px 32px; font-weight: 700; font-size: 28px; letter-spacing: 8px; margin-bottom: 32px;">
        ${code}
      </div>
      
      <!-- Elválasztó vonal -->
      <div style="border-top: 1px solid #f3f4f6; margin: 0 0 24px 0;"></div>
      
      <!-- Lábjegyzet -->
      <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 0;">
        If you didn't request this change, you can safely ignore this email.<br>Your account security will not be affected.
      </p>

    </div>
    
  </div>
  `
});

  if (error) {
    console.error('Hiba a Resend küldésekor:', error);
    return false;
  }

  console.log('Email sikeresen elküldve. Resend ID:', data.id);
  return true;
}


const sendCode = async (userEmail, code) => {
 

 const { data, error } = await resend.emails.send({
  from: 'Claudify <onboarding@resend.dev>', 
  to: userEmail,
  subject: 'Account Deletion Request',
  html: `
     <div style="background-color: #f9fafb; padding: 60px 20px; text-align: center; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    
    <div style="max-width: 440px; margin: 0 auto; background-color: #ffffff; padding: 40px 32px; border-radius: 12px; border: 1px solid #f3f4f6; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.04);">
      
      <h2 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0 0 12px 0;">
        Account Deletion Request
      </h2>
      
      <p style="color: #6b7280; font-size: 15px; line-height: 1.6; margin: 0 0 32px 0;">
        We received a request to permanently delete your <strong>Claudify</strong> account. Please use the verification code below to confirm this action.
      </p>
      
      <div style="display: inline-block; background-color: #1a1a1a; color: #ffffff; border-radius: 8px; padding: 16px 32px; font-weight: 700; font-size: 28px; letter-spacing: 8px; margin-bottom: 24px;">
        ${code}
      </div>
      
      <p style="color: #ef4444; font-size: 14px; font-weight: 600; margin: 0 0 32px 0;">
        Warning: This action is permanent and cannot be undone.
      </p>
      
      <div style="border-top: 1px solid #f3f4f6; margin: 0 0 24px 0;"></div>
      
      <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 0;">
        If you didn't request to delete your account, please ignore this email or change your password immediately.<br>Your account remains safe.
      </p>

    </div>
    
  </div>
  `
});

  if (error) {
    console.error('Hiba a Resend küldésekor:', error);
    return false;
  }

  console.log('Email sikeresen elküldve. Resend ID:', data.id);
  return true;
}

export default {sendPasswordResetEmail, sendEmailChangeCode, sendCode}