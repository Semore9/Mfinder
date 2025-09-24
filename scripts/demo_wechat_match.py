#!/usr/bin/env python3
"""Quick demo for newly added WeChat secret regex rules."""
from __future__ import annotations

import re
from collections import OrderedDict
from pathlib import Path

sample_path = Path("testdata/miniapp/sample-v1/app-config.json")
text = sample_path.read_text(encoding="utf-8")

rules = OrderedDict(
    [
        (
            "微信支付",
            [
                r"(?i)[\[\"']?(?:mch[_-]?id|mchid|merchant[_-]?id)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[0-9]{8,}\b)",
                r"(?i)[\[\"']?(?:api(?:_v3)?[_-]?key|pay[_-]?key|partner[_-]?key)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9]{16,})",
                r"(?i)[\[\"']?serial[_-]?no[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Fa-f0-9]{12,})",
                r"(?i)[\[\"']?apiclient_(?:cert|key)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[\w./\\-]+\.pem\b)",
            ],
        ),
        (
            "微信开放平台",
            [
                r"(?i)\bwx[0-9a-f]{16}\b",
                r"(?i)[\[\"']?(?:app|component|authorizer)[_-]?secret[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Fa-f0-9]{16,})",
                r"(?i)[\[\"']?(?:component|authorizer)[_-]?(?:appid|token|refresh[_-]?token)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9_-]{16,})",
            ],
        ),
        (
            "微信会话",
            [
                r"(?i)[\[\"']?(?:session[_-]?key|session[_-]?token)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9+/=]{16,})",
                r"(?i)[\[\"']?(?:openid|unionid)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9_-]{10,})",
            ],
        ),
        (
            "腾讯云",
            [
                r"(?i)[\[\"']?(?:tencentcloud|qcloud|cos|scf)[_-]?(?:secret[_-]?id|secret[_-]?key)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9]{16,})",
                r"(?i)[\[\"']?(?:env[_-]?id|envid)[\"'\]]?[^\S\r\n]*[=:][^\S\r\n]*('[^'\r\n]+'|\"[^\"\r\n]+\"|[A-Za-z0-9-]{5,})",
                r"(?i)cloud://[a-z0-9-]+(?:\.[a-z0-9-]+)+/[\w./-]+",
            ],
        ),
    ]
)

for rule_name, expressions in rules.items():
    seen: list[str] = []
    for expr in expressions:
        pattern = re.compile(expr)
        for match in pattern.finditer(text):
            value = match.group(0)
            if value and value not in seen:
                seen.append(value)
    if seen:
        print(f"[{rule_name}] {len(seen)} 命中")
        for item in seen:
            print(f"  - {item}")
    else:
        print(f"[{rule_name}] 未命中")
