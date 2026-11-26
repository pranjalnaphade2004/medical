require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const nodemailer = require("nodemailer");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data", "wellora.sqlite");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.exec(`CREATE TABLE IF NOT EXISTS subscribers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending', confirm_token_hash TEXT,
 confirm_expires_at INTEGER, unsubscribe_token_hash TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, confirmed_at TEXT, unsubscribed_at TEXT
);`);

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

const signupLimit = rateLimit({ windowMs: 15*60*1000, limit: 5, standardHeaders: "draft-8", legacyHeaders: false,
 message: { error: "Too many signup attempts. Please wait and try again." } });
const confirmLimit = rateLimit({ windowMs: 15*60*1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const validEmail = value => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function smtpConfig() {
 const host = String(process.env.SMTP_HOST || "").trim();
 const port = Number(process.env.SMTP_PORT || 587);
 const secure = String(process.env.SMTP_SECURE || (port === 465 ? "true" : "false")).toLowerCase() === "true";
 const user = String(process.env.SMTP_USER || "").trim();
 const pass = String(process.env.SMTP_PASS || "");
 const from = String(process.env.MAIL_FROM || "").trim();
 const missing = [];
 if (!host) missing.push("SMTP_HOST");
 if (!Number.isInteger(port) || port < 1 || port > 65535) missing.push("SMTP_PORT (1-65535)");
 if (!user) missing.push("SMTP_USER");
 if (!pass) missing.push("SMTP_PASS");
 if (!from) missing.push("MAIL_FROM");
 if (missing.length) { const e = new Error("SMTP configuration incomplete: " + missing.join(", ")); e.code = "SMTP_CONFIG"; throw e; }
 return { host, port, secure, auth: { user, pass }, from,
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 10000),
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 10000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
  requireTLS: String(process.env.SMTP_REQUIRE_TLS || (port === 587 ? "true" : "false")).toLowerCase() === "true"
 };
}
function mailer() {
 const cfg = smtpConfig();
 const { from, ...transportOptions } = cfg;
 return { transport: nodemailer.createTransport(transportOptions), from };
}

async function sendConfirmation(email, rawToken) {
 const url = `${BASE_URL}/confirm?token=${encodeURIComponent(rawToken)}`;
 const mail = mailer();
 await mail.transport.sendMail({
  from: mail.from, to: email,
  subject: "Confirm your Wellora newsletter subscription",
  text: `Thanks for your interest in Wellora. Confirm your email: ${url}\\n\\nThis link expires in 24 hours. If you did not request this, ignore this email.`,
  html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#183b30;line-height:1.6"><h1 style="color:#1d654f">Welcome to Wellora</h1><p>Thanks for signing up for thoughtful health and wellness updates.</p><p>Please confirm your email address. You will only be subscribed after confirmation.</p><p style="margin:28px 0"><a href="${url}" style="background:#1d654f;color:#fff;text-decoration:none;padding:14px 22px;border-radius:30px;display:inline-block;font-weight:bold">Confirm my email</a></p><p>This link expires in 24 hours. If you did not request this, safely ignore this message.</p><hr><small>Wellora · Health & Wellness</small></div>`
 });
}

app.post("/api/subscribe", signupLimit, async (req,res) => {
 const email = String(req.body.email || "").trim().toLowerCase();
 if (req.body.consent !== true) return res.status(400).json({ error: "Please agree to receive Wellora newsletter emails." });
 if (!validEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
 const existing = db.prepare("SELECT * FROM subscribers WHERE email=?").get(email);
 if (existing && existing.status === "confirmed") return res.json({ message: "If this address can be subscribed, a confirmation email has been sent." });
 const rawToken = newToken(), tokenHash = hash(rawToken), expires = Date.now()+24*60*60*1000;
 const unsubscribeHash = existing?.unsubscribe_token_hash || hash(newToken());
 if (existing) {
  db.prepare("UPDATE subscribers SET status='pending',confirm_token_hash=?,confirm_expires_at=?,unsubscribed_at=NULL WHERE email=?").run(tokenHash,expires,email);
 } else {
  db.prepare("INSERT INTO subscribers(email,status,confirm_token_hash,confirm_expires_at,unsubscribe_token_hash) VALUES(?,'pending',?,?,?)").run(email,tokenHash,expires,unsubscribeHash);
 }
 try { await sendConfirmation(email,rawToken); return res.json({ message: "Please check your inbox to confirm your email address." }); }
 catch(err) { console.error("Confirmation email failed:",err.message); return res.status(503).json({ error: "We couldn't send the confirmation email right now. Please try again later." }); }
});

app.get("/confirm",confirmLimit,(req,res)=>{
 const rawToken=String(req.query.token||"");
 if(!/^[a-f0-9]{64}$/.test(rawToken)) return res.redirect("/#/confirm-error");
 const row=db.prepare("SELECT id,confirm_expires_at FROM subscribers WHERE confirm_token_hash=? AND status='pending'").get(hash(rawToken));
 if(!row||!row.confirm_expires_at||row.confirm_expires_at<Date.now()) return res.redirect("/#/confirm-error");
 db.prepare("UPDATE subscribers SET status='confirmed',confirmed_at=CURRENT_TIMESTAMP,confirm_token_hash=NULL,confirm_expires_at=NULL WHERE id=?").run(row.id);
 return res.redirect("/#/confirmed");
});

app.get("/unsubscribe",(req,res)=>{
 const rawToken=String(req.query.token||"");
 if(!/^[a-f0-9]{64}$/.test(rawToken)) return res.status(400).send("Invalid unsubscribe link.");
 const row=db.prepare("SELECT id FROM subscribers WHERE unsubscribe_token_hash=?").get(hash(rawToken));
 if(!row) return res.status(404).send("This unsubscribe link is not valid.");
 res.type("html").send(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Unsubscribe | Wellora</title><body style="font:16px Arial;max-width:520px;margin:70px auto;padding:20px;color:#183b30"><h1>Unsubscribe from Wellora</h1><p>Click below to stop receiving newsletter emails.</p><form method="post" action="/unsubscribe"><input type="hidden" name="token" value="${rawToken}"><button style="padding:13px 22px;border:0;border-radius:24px;background:#1d654f;color:white;font-weight:bold">Unsubscribe</button></form></body></html>`);
});
app.post("/unsubscribe",(req,res)=>{
 const rawToken=String(req.body.token||"");
 if(!/^[a-f0-9]{64}$/.test(rawToken)) return res.status(400).send("Invalid unsubscribe link.");
 const result=db.prepare("UPDATE subscribers SET status='unsubscribed',unsubscribed_at=CURRENT_TIMESTAMP,confirm_token_hash=NULL,confirm_expires_at=NULL WHERE unsubscribe_token_hash=?").run(hash(rawToken));
 if(!result.changes) return res.status(404).send("This unsubscribe link is not valid.");
 res.type("html").send(`<!doctype html><html><meta name="viewport" content="width=device-width"><title>Unsubscribed | Wellora</title><body style="font:16px Arial;max-width:520px;margin:70px auto;padding:20px;color:#183b30"><h1>You are unsubscribed</h1><p>You will no longer receive Wellora newsletter emails.</p><a href="/">Return to Wellora</a></body></html>`);
});

app.post("/api/admin/smtp-test", async (req,res) => {
 const expected = process.env.ADMIN_API_TOKEN || "";
 const supplied = String(req.get("x-admin-token") || "");
 if (!expected || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return res.status(401).json({error:"Unauthorized."});
 const to = String(req.body.to || "").trim().toLowerCase();
 if (!validEmail(to)) return res.status(400).json({error:"Provide a valid test recipient email."});
 try {
  const mail = mailer();
  await mail.transport.verify();
  const sent = await mail.transport.sendMail({from:mail.from,to,subject:"Wellora SMTP configuration test",text:"Your Wellora SMTP configuration successfully sent this test email.",html:"<p>Your Wellora SMTP configuration successfully sent this test email.</p>"});
  return res.json({ok:true,message:"SMTP verified and test message accepted by mail server.",messageId:sent.messageId});
 } catch(err) {
  console.error("SMTP diagnostic failed:",err.message);
  return res.status(503).json({error:"SMTP test failed. Check server logs and SMTP environment variables.",code:err.code||"SMTP_ERROR"});
 }
});
app.get("/api/health",(req,res)=>res.json({ok:true,service:"wellora"}));
app.use(express.static(path.join(__dirname,"public"),{extensions:["html"]}));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Wellora running on port ${PORT}`));
