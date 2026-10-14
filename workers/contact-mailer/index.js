import { EmailMessage } from "cloudflare:email";
import { createMailer } from "./mailer.js";

// No public URL or routes: only the website's private service binding calls this.
export default createMailer(EmailMessage);
