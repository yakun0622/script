#!/usr/bin/env python3
"""BBXY daily check-in.

Credentials are read from environment variables:
- BBXY_EMAIL
- BBXY_PASSWORD
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from http.cookiejar import CookieJar
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE_URL = "https://cn4.cardsakura.buzz"
LOGIN_URL = f"{BASE_URL}/v2/login"
CHECKIN_URL = f"{BASE_URL}/user/checkin"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/150.0.0.0 Safari/537.36"
)
TIMEOUT = 30


def build_multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []

    for name, value in fields.items():
        parts.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )

    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def parse_json(raw: bytes) -> dict:
    text = raw.decode("utf-8", errors="replace")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Response is not valid JSON: {text[:500]}") from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"Unexpected JSON response: {data!r}")
    return data


def request_json(opener, request: Request) -> dict:
    try:
        with opener.open(request, timeout=TIMEOUT) as response:
            return parse_json(response.read())
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body[:500]}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error: {exc.reason}") from exc


def login(opener, email: str, password: str) -> dict:
    body, boundary = build_multipart(
        {
            "email": email,
            "passwd": password,
            "code_2fa": "",
            "2fa-code": "",
        }
    )

    request = Request(
        LOGIN_URL,
        data=body,
        method="POST",
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Origin": BASE_URL,
            "Referer": LOGIN_URL,
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    return request_json(opener, request)


def checkin(opener) -> dict:
    request = Request(
        CHECKIN_URL,
        data=b"",
        method="POST",
        headers={
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Origin": BASE_URL,
            "Referer": f"{BASE_URL}/user",
            "User-Agent": USER_AGENT,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    return request_json(opener, request)


def is_already_checked_in(message: str) -> bool:
    normalized = message.lower()
    return any(keyword in normalized for keyword in ("已签到", "已经签到", "重复签到", "already"))


def main() -> int:
    email = os.getenv("BBXY_EMAIL", "").strip()
    password = os.getenv("BBXY_PASSWORD", "")

    if not email or not password:
        print("ERROR: BBXY_EMAIL and BBXY_PASSWORD must be configured.", file=sys.stderr)
        return 2

    cookie_jar = CookieJar()
    opener = build_opener(HTTPCookieProcessor(cookie_jar))

    try:
        login_result = login(opener, email, password)
        print(f"Login response: {json.dumps(login_result, ensure_ascii=False)}")
        if login_result.get("ret") != 1:
            raise RuntimeError(f"Login failed: {login_result.get('msg', 'unknown error')}")

        checkin_result = checkin(opener)
        print(f"Check-in response: {json.dumps(checkin_result, ensure_ascii=False)}")

        message = str(checkin_result.get("msg", ""))
        if checkin_result.get("ret") == 1 or is_already_checked_in(message):
            print(f"BBXY check-in succeeded: {message or 'success'}")
            return 0

        raise RuntimeError(f"Check-in failed: {message or checkin_result}")
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
