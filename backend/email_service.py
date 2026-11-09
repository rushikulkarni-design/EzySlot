import os
import logging
import smtplib
from pathlib import Path
from email.message import EmailMessage

logger = logging.getLogger("EzySlot.email")


def _attach_inline_upi_qr(html_part, html: str) -> bool:
    """Attach the configured UPI QR image for use as cid:upi_qr in HTML."""
    if "cid:upi_qr" not in html:
        return False

    configured = os.getenv("UPI_QR_PATH", "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())
    candidates.append(Path(__file__).resolve().with_name("upi-qr.jpeg"))
    candidates.append(Path(__file__).resolve().parent / "public" / "upi-qr.jpeg")

    qr_path = next((p for p in candidates if p.is_file()), None)
    if qr_path is None:
        raise FileNotFoundError(
            "UPI QR image not found. Set UPI_QR_PATH in backend/.env "
            "or place upi-qr.jpeg beside email_service.py"
        )

    image_data = qr_path.read_bytes()
    subtype = "png" if qr_path.suffix.lower() == ".png" else "jpeg"
    html_part.add_related(
        image_data,
        maintype="image",
        subtype=subtype,
        cid="<upi_qr>",
        filename=qr_path.name,
        disposition="inline",
    )
    return True


async def send_email(
    db,
    to: str,
    subject: str,
    html: str,
    kind: str = "notification",
) -> dict:
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com").strip()
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "").strip()
    smtp_password = os.getenv("SMTP_PASSWORD", "").replace(" ", "").strip()
    sender = os.getenv("SMTP_FROM", smtp_user).strip()

    record = {"to": to, "subject": subject, "kind": kind}

    try:
        if not smtp_user or not smtp_password:
            raise ValueError("SMTP_USER or SMTP_PASSWORD is missing")

        message = EmailMessage()
        message["From"] = sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(
            "Please view this email in an HTML-compatible email client. "
            "If the QR image is not visible, use the UPI ID included in the message."
        )

        # EmailMessage.add_alternative() mutates the message and returns None.
        # Retrieve the HTML MIME part from the message payload before adding CID images.
        message.add_alternative(html, subtype="html")
        html_part = message.get_payload()[-1]
        _attach_inline_upi_qr(html_part, html)

        with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.send_message(message)

        record["status"] = "sent"
        try:
            await db.email_queue.insert_one(dict(record))
        except Exception:
            logger.exception("Could not record sent email in queue")

        logger.info("Email sent successfully to %s", to)
        return {"status": "sent"}

    except Exception as e:
        logger.exception("Email sending failed")
        record["status"] = "failed"
        record["reason"] = str(e)[:200]
        try:
            await db.email_queue.insert_one(dict(record))
        except Exception:
            logger.exception("Could not record failed email")
        return {"status": "failed", "reason": str(e)[:200]}
