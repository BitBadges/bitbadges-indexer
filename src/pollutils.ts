import sgMail from '@sendgrid/mail';
import { QueueDoc } from 'bitbadgesjs-sdk';
import crypto from 'crypto';
import { getFromDB, insertToDB } from './db/db';
import { ProfileModel, QueueModel } from './db/schemas';
import * as Discord from 'discord.js';

export enum NotificationType {
  TransferActivity = 'transfer',
  List = 'list',
  ClaimAlert = 'claimAlert'
}

export async function sendPushNotificationToDiscord(user: string, message: string) {
  try {
    // Initialize Discord client
    const client = new Discord.Client({
      intents: ['Guilds', 'GuildMembers']
    });

    // Login to Discord with your bot token
    await client.login(process.env.BOT_TOKEN);

    // Find the user by their username and discriminator
    const targetUser = await client.guilds.fetch('846474505189588992').then((guild) => {
      return guild.members.fetch(user);
    });

    // If the user is found, send them a direct message
    if (targetUser) {
      await targetUser.send(message);
      console.log(`Message sent to ${user}: ${message}`);
    } else {
      console.error(`User ${user} not found.`);
    }

    // Logout from Discord
    await client.destroy();
  } catch (error) {
    console.error('Error sending Discord message:', error);
  }
}
export async function sendPushNotification(
  address: string,
  type: string,
  message: string,
  docId: string,
  initiatedBy?: string,
  queueDoc?: QueueDoc<bigint>
) {
  try {
    const profile = await getFromDB(ProfileModel, address);
    if (!profile) return;

    let subject = '';
    switch (type) {
      case NotificationType.TransferActivity:
        subject = 'BitBadges Notification - Transfer Activity';
        break;
      case NotificationType.List:
        subject = 'BitBadges Notification - List Activity';
        break;
      case NotificationType.ClaimAlert:
        subject = 'BitBadges Notification - Claim Alert';
        break;
    }

    const toReceiveListActivity = profile.notifications?.preferences?.listActivity;
    const toReceiveTransferActivity = profile.notifications?.preferences?.transferActivity;
    const toReceiveClaimAlerts = profile.notifications?.preferences?.claimAlerts;

    const ignoreIfInitiator = profile.notifications?.preferences?.ignoreIfInitiator;
    if (ignoreIfInitiator && initiatedBy && initiatedBy === address) return;

    if (type === NotificationType.List && !toReceiveListActivity) return;
    if (type === NotificationType.TransferActivity && !toReceiveTransferActivity) return;
    if (type === NotificationType.ClaimAlert && !toReceiveClaimAlerts) return;

    const antiPhishingCode = profile.notifications?.emailVerification?.antiPhishingCode ?? '';

    if (profile.notifications?.email) {
      if (!profile.notifications?.emailVerification?.verified) return;

      const token = profile.notifications.emailVerification.token;
      if (!token) return;

      const emails: Array<{
        to: string;
        from: string;
        subject: string;
        html: string;
      }> = [
        {
          to: profile.notifications.email,
          from: 'info@mail.bitbadges.io',
          subject,
          html: PushNotificationEmailHTML(message, antiPhishingCode, token)
        }
      ];

      sgMail.setApiKey(process.env.SENDGRID_API_KEY ? process.env.SENDGRID_API_KEY : '');
      await sgMail.send(emails, true);
    }

    if (profile.notifications?.discord && profile.notifications.discord.id) {
      const discordUser = profile.notifications.discord.id;
      const discordMessage = `**${subject}**\n\n${message}\n\nAnti-Phishing Code: ${antiPhishingCode}\n\nUnsubscribe?: Go to https://api.bitbadges.io/api/v0/unsubscribe/${profile.notifications.discord.token}`;
      await sendPushNotificationToDiscord(discordUser, discordMessage);
    }
  } catch (e) {
    const queueObj = queueDoc ?? {
      _docId: crypto.randomBytes(16).toString('hex'),
      uri: '',
      collectionId: 0n,
      loadBalanceId: 0n,
      activityDocId: docId,
      refreshRequestTime: BigInt(Date.now()),
      numRetries: 0n,
      lastFetchedAt: BigInt(Date.now()),
      nextFetchTime: BigInt(Date.now() + 1000 * 60),
      emailMessage: message,
      recipientAddress: address,
      notificationType: type
    };

    const BASE_DELAY = process.env.BASE_DELAY ? Number(process.env.BASE_DELAY) : 1000 * 60 * 60 * 1; // 1 hour
    const delay = BASE_DELAY * Math.pow(2, Number(queueObj.numRetries + 1n));

    let reason = '';
    try {
      reason = e.toString();
    } catch (e) {
      try {
        reason = JSON.stringify(e);
      } catch (e) {
        reason = 'Could not stringify error message';
      }
    }
    await insertToDB(
      QueueModel,
      new QueueDoc({
        ...queueObj,
        lastFetchedAt: BigInt(Date.now()),
        error: reason,
        numRetries: BigInt(queueObj.numRetries + 1n),
        nextFetchTime: BigInt(delay) + BigInt(Date.now())
      })
    );
  }
}

export const PushNotificationEmailHTML = (message: string, antiPhishingCode: string, token: string) => {
  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
      <!--[if !mso]><!-->
      <meta http-equiv="X-UA-Compatible" content="IE=Edge">
      <!--<![endif]-->
      <!--[if (gte mso 9)|(IE)]>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
      <![endif]-->
      <!--[if (gte mso 9)|(IE)]>
  <style type="text/css">
    body {width: 600px;margin: 0 auto;}
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
<![endif]-->
      <style type="text/css">
    body, p, div {
      font-family: arial,helvetica,sans-serif;
      font-size: 14px;
    }
    body {
      color: #000000;
    }
    body a {
      color: #1188E6;
      text-decoration: none;
    }
    p { margin: 0; padding: 0; }
    table.wrapper {
      width:100% !important;
      table-layout: fixed;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    img.max-width {
      max-width: 100% !important;
    }
    .column.of-2 {
      width: 50%;
    }
    .column.of-3 {
      width: 33.333%;
    }
    .column.of-4 {
      width: 25%;
    }
    ul ul ul ul  {
      list-style-type: disc !important;
    }
    ol ol {
      list-style-type: lower-roman !important;
    }
    ol ol ol {
      list-style-type: lower-latin !important;
    }
    ol ol ol ol {
      list-style-type: decimal !important;
    }
    @media screen and (max-width:480px) {
      .preheader .rightColumnContent,
      .footer .rightColumnContent {
        text-align: left !important;
      }
      .preheader .rightColumnContent div,
      .preheader .rightColumnContent span,
      .footer .rightColumnContent div,
      .footer .rightColumnContent span {
        text-align: left !important;
      }
      .preheader .rightColumnContent,
      .preheader .leftColumnContent {
        font-size: 80% !important;
        padding: 5px 0;
      }
      table.wrapper-mobile {
        width: 100% !important;
        table-layout: fixed;
      }
      img.max-width {
        height: auto !important;
        max-width: 100% !important;
      }
      a.bulletproof-button {
        display: block !important;
        width: auto !important;
        font-size: 80%;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .columns {
        width: 100% !important;
      }
      .column {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .social-icon-column {
        display: inline-block !important;
      }
    }
  </style>
      <!--user entered Head Start--><!--End Head user entered-->
    </head>
    <body>
      <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:arial,helvetica,sans-serif; color:#000000; background-color:#FFFFFF;">
        <div class="webkit">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#FFFFFF">
            <tr>
              <td valign="top" bgcolor="#FFFFFF" width="100%">
                <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="100%">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td>
                            <!--[if mso]>
    <center>sendg
    <table><tr><td width="600">
  <![endif]-->
                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                      <tr>
                                        <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left"><table class="module preheader preheader-hide" role="module" data-type="preheader" border="0" cellpadding="0" cellspacing="0" width="100%" style="display: none !important; mso-hide: all; visibility: hidden; opacity: 0; color: transparent; height: 0; width: 0;">
    <tr>
      <td role="module-content">
        <p></p>
      </td>
    </tr>
  </table><table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="03460a48-1a16-4fa3-9d8d-2e55003bcefb">
    <tbody>
      <tr>
        <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
          <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Helvetica, arial, sans-serif; font-size:16px; max-width:100% !important; width:100%; height:auto !important;" width="600" alt="" data-proportionally-constrained="true" data-responsive="true" src="http://cdn.mcauto-images-production.sendgrid.net/6ef6241ea0a2dae3/3f99226a-9d32-45fd-baa6-5712ef69edf2/1478x309.png">
        </td>
      </tr>
    </tbody>
  </table><table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;" data-muid="6a9044d8-176b-46e3-9b3a-8bdd5d60a505" data-mc-module-version="2019-10-22">
    <tbody>
      <tr>
        <td style="padding:12px 0px 18px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content"><div><div style="font-family: inherit; text-align: inherit">${message}</div>
<div style="font-family: inherit; text-align: inherit"><br></div>
<div style="font-family: inherit; text-align: inherit">Your anti-phishing code is: <strong>${antiPhishingCode}</strong></div>
<div style="font-family: inherit; text-align: inherit"><span style="font-size: 12px">Please make sure this matches the one you set in your BitBadges account.All emails from BitBadges will include this code.</span></div>
<div style="font-family: inherit; text-align: inherit"><br>
<span style="font-family: Söhne, ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, Ubuntu, Cantarell, &quot;Noto Sans&quot;, sans-serif, &quot;Helvetica Neue&quot;, Arial, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space-collapse: preserve; text-wrap: wrap; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; float: none; display: inline; font-size: 12px">Attention: Beware of phishing attempts in the crypto space. Scammers often impersonate legitimate platforms or individuals to trick users into revealing sensitive information or transferring funds. Always verify the authenticity of any communication before taking action, and never share your private keys or passwords. Stay vigilant and prioritize security to protect your assets from potential threats.</span></div>
<div style="font-family: inherit; text-align: inherit"><br></div>
<div style="font-family: inherit; text-align: inherit"><span style="font-family: Söhne, ui-sans-serif, system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, Ubuntu, Cantarell, &quot;Noto Sans&quot;, sans-serif, &quot;Helvetica Neue&quot;, Arial, &quot;Apple Color Emoji&quot;, &quot;Segoe UI Emoji&quot;, &quot;Segoe UI Symbol&quot;, &quot;Noto Color Emoji&quot;; font-style: normal; font-variant-ligatures: normal; font-variant-caps: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space-collapse: preserve; text-wrap: wrap; text-decoration-thickness: initial; text-decoration-style: initial; text-decoration-color: initial; float: none; display: inline; font-size: 12px">BitBadges will never ask for your private key or any private information over email. Always verify that BitBadges emails come from @mail.bitbadges.io. We will also not make you click any links from any emails. To unsubscribe, go to https://api.bitbadges.io/api/v0/unsubscribe/${token}.</span></div><div></div></div></td>

</tr>
    </tbody>
  </table>
      </center>
    </body>
  </html>
  `;
};
