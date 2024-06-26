import { mailGenerator, mailTransport } from 'src/common/configs';

const PasswordResetMail = class {
  async mail(email: string, otp: string, name: string) {
    const html = {
      body: {
        signature: false,
        greeting: `Hello ${name}`,
        intro: [
          'You are receiving this message because you have requested for a password reset of your family tree account',
          'To reset your password, use the OTP below',
          '',
          `<b>OTP:<b/> ${otp}`,
        ],

        outro: [
          `If you are recieving this mail, and you did not initiate the recovery action, proceed to take neccessary steps to protect your account.`,
          `For security reasons this otp will expire in 10 minutes, make sure to use it before then or you'll have to request for a new one.`,
          `If you encounter any issues or need further assistance, please do not hesitate to contact us at support@familytree.com`,
        ],
      },
    };
    const template = mailGenerator.generate(html);
    const mail = {
      to: email,
      subject: 'Family-Tree | Password Reset',
      from: process.env.SENDING_MAIL,
      html: template,
    };
    return mailTransport(mail.from, mail.to, mail.subject, mail.html);
    // return mailTransport(mail);
  }
};

export const passwordResetMail = new PasswordResetMail();
