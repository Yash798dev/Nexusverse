const dns = require("dns");
const net = require("net");
const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || `Agentic YouTube <no-reply@agentic.local>`;

// Nodemailer resolves the SMTP host with its own `new dns.Resolver()`, which does
// not inherit the dns.setServers() override in server.js and queries the system
// DNS server directly — on this machine 127.0.0.1, which never answers those
// queries ("queryA ETIMEOUT smtp.gmail.com"). Resolve through the OS resolver
// (dns.lookup) instead, connect by IP, and keep the hostname as the TLS
// servername so SNI and certificate validation still work.
async function resolveSmtpHost() {
  if (net.isIP(SMTP_HOST)) return SMTP_HOST;
  const { address } = await dns.promises.lookup(SMTP_HOST, { family: 4 });
  return address;
}

// create transporter only if SMTP vars present
let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  resolveSmtpHost()
    .then((host) => {
      transporter = nodemailer.createTransport({
        host,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // true for 465, false for other ports
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS
        },
        tls: { servername: SMTP_HOST }
      });
      // verify transporter
      return transporter.verify();
    })
    .then(() => console.log("SMTP transporter ready"))
    .catch(err => {
      console.warn("SMTP verify failed:", err.message || err);
      transporter = null;
    });
}

async function sendEmail(to, subject, text, html = null) {
  // fallback: log OTP to console if transporter not configured
  if (!transporter) {
    console.log(`(DEV EMAIL) -> to ${to}: ${subject}\n${text}`);
    return { ok: true, dev: true };
  }

  try {
    const info = await transporter.sendMail({
      from: FROM_EMAIL,
      to,
      subject,
      text,
      html
    });
    return { ok: true, info };
  } catch (err) {
    console.error("sendEmail error:", err);
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = { sendEmail };
