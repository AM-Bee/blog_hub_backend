import { Injectable } from '@nestjs/common';
import { gmail, auth } from 'googleapis/build/src/apis/gmail/index.js';
import MailComposer from 'nodemailer/lib/mail-composer';
import { contactMailSettings } from './contact.config.js';
import type { CreateContactDto } from './dto/create-contact.dto.js';

@Injectable()
export class GmailMailService {
  // Validate during Nest provider construction, before the web service starts.
  private readonly settings = contactMailSettings();
  private readonly client;

  constructor() {
    const oauth = new auth.OAuth2({
      clientId: this.settings.clientId,
      clientSecret: this.settings.clientSecret,
      transporterOptions: { timeout: 10_000, retry: false },
    });
    oauth.setCredentials({ refresh_token: this.settings.refreshToken });
    this.client = gmail({ version: 'v1', auth: oauth });
  }

  async send(input: CreateContactDto): Promise<void> {
    // Reuse only the installed MIME builder; delivery never uses an SMTP transport.
    const message = await new MailComposer({
      from: this.settings.from,
      to: this.settings.to,
      replyTo: { name: input.name, address: input.email },
      subject: `[BlogHub Contact] ${input.subject}`,
      text: `Sender: ${input.name}\nEmail: ${input.email}\nSubject: ${input.subject}\n\n${input.message}`,
      textEncoding: 'base64',
      disableFileAccess: true,
      disableUrlAccess: true,
    })
      .compile()
      .build();
    const result = await this.client.users.messages.send(
      { userId: 'me', requestBody: { raw: message.toString('base64url') } },
      { timeout: 10_000, retry: false, signal: AbortSignal.timeout(15_000) },
    );
    if (!result.data.id) throw new Error('Gmail send not acknowledged');
  }
}
