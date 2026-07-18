# BBXY 自动签到

使用 GitHub Actions 每天自动登录并完成 BBXY 签到。

## 配置 GitHub Secrets

进入仓库：

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

添加以下两个 Repository secrets：

| Secret | 说明 |
| --- | --- |
| `BBXY_EMAIL` | BBXY 登录邮箱/用户名 |
| `BBXY_PASSWORD` | BBXY 登录密码 |

账号密码不会写入代码或 Workflow 日志。

## 自动执行时间

Workflow 默认每天执行一次：

- UTC：01:05
- 中国标准时间（UTC+8）：09:05

GitHub Actions 的定时任务可能存在少量延迟。

## 手动测试

配置 Secrets 后，可以进入：

`Actions` → `BBXY Daily Check-in` → `Run workflow`

手动触发一次签到，检查运行日志确认是否成功。

## 文件说明

- `checkin.py`：登录并签到，使用 CookieJar 自动维护登录 Cookie。
- `.github/workflows/bbxy-checkin.yml`：每日定时签到 Workflow。

脚本不保存浏览器抓包中的 `cf_clearance`、`PHPSESSID`、`uid`、`key` 等临时 Cookie，而是在每次运行时重新登录并使用登录响应生成的 Cookie 完成签到。
