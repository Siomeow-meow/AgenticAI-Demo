import type { Tool } from '../tool-types'

const enc = encodeURIComponent

export const commsTools: Tool[] = [
  {
    name: 'compose_email',
    category: 'Communication',
    description: 'Write an email and give a link that opens it, ready to send, in the user\'s own email app. Nothing is sent automatically.',
    keywords: 'email mail send write draft compose message reply to cc subject outlook gmail letter notify someone by email',
    parameters: {
      to: { type: 'string', description: 'Recipient email address(es), comma separated', optional: true },
      subject: { type: 'string', description: 'Subject line' },
      body: { type: 'string', description: 'The email text' },
    },
    run: ({ to = '', subject, body }) => {
      const link = `mailto:${to.split(/[,;\s]+/).filter(Boolean).join(',')}?subject=${enc(subject)}&body=${enc(body)}`
      return `Draft ready (not sent).\nTo: ${to || '(choose in your email app)'}\nSubject: ${subject}\n\n${body}\n\nOpen in your email app: ${link.length < 1800 ? link : '(the draft is too long for a link: copy the text above)'}`
    },
  },
  {
    name: 'compose_sms',
    category: 'Communication',
    description: 'Prepare a text message and give a link that opens it in the user\'s messaging app. Nothing is sent automatically.',
    keywords: 'sms text message whatsapp phone send text txt mobile compose message to number',
    parameters: {
      to: { type: 'string', description: 'Phone number', optional: true },
      message: { type: 'string', description: 'The message text' },
    },
    run: ({ to = '', message }) => `Message ready (not sent):\n${message}\n\nOpen in your messaging app: sms:${to.replace(/[^\d+]/g, '')}?body=${enc(message)}`,
  },
  {
    name: 'send_notification',
    category: 'Communication',
    description: 'Show a desktop notification right now (the browser asks permission the first time).',
    keywords: 'notify notification alert popup desktop ping tell me remind now notice toast',
    parameters: {
      title: { type: 'string', description: 'Notification title' },
      message: { type: 'string', description: 'Notification text', optional: true },
    },
    run: async ({ title, message = '' }) => {
      if (typeof Notification === 'undefined') return 'This browser does not support notifications.'
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      if (permission !== 'granted') return 'Notifications are blocked: allow them for this site in the browser settings.'
      new Notification(title, { body: message })
      return `Notification shown: ${title}`
    },
  },
  {
    name: 'post_webhook',
    category: 'Communication',
    network: true,
    confirm: true,
    describe: ({ url, message }) => `Post "${message.slice(0, 80)}" to ${url.slice(0, 60)}...`,
    description: 'Post a message to a Slack, Microsoft Teams or Discord channel through its incoming-webhook URL (the user must provide the URL).',
    keywords: 'slack teams discord webhook post message channel announce chat send to channel team notify group',
    parameters: {
      url: { type: 'string', description: 'The incoming webhook URL' },
      message: { type: 'string', description: 'The message text' },
    },
    run: async ({ url, message }) => {
      if (!/^https:\/\//i.test(url)) return 'The webhook URL must start with https://.'
      const discord = /discord(app)?\.com\/api\/webhooks/i.test(url)
      try {
        // A plain-text POST in no-cors mode is allowed from any page; the reply cannot be read, so success is assumed.
        await fetch(url, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(discord ? { content: message } : { text: message }),
          signal: AbortSignal.timeout(10000),
        })
        return 'Posted to the webhook. The browser cannot read the reply, so check the channel to confirm.'
      } catch (e) {
        return `Could not reach the webhook: ${(e as Error).message}`
      }
    },
  },
]
