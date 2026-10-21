# 定义

定义服务器中的项目根目录为 `{project}`。

源代码仓库中的 Compose 文件位于 `conf/compose/docker-compose.yml`。
使用部署脚本安装后，服务器上的 Compose 文件位于 `{project}/docker-compose.yml`。

# 服务器接入（SSH）

生产服务器为阿里云 ECS，通过 SSH 公钥登录。服务器**已禁用密码登录**，仅接受公钥认证。

连接参数保存在本地 `backend/.env`：

| 变量 | 说明 |
|-|-|
| `ALIYUN_SSH_IP` | 服务器公网 IP |
| `ALIYUN_SSH_PORT` | SSH 端口（22） |
| `ALIYUN_SSH_KEY_PATH` | 本机 SSH 私钥文件路径（绝对路径） |

私钥文件保存在开发者本机，路径由 `ALIYUN_SSH_KEY_PATH` 指定，**严禁提交到任何仓库**。

登录命令（参数从 `backend/.env` 中读取）：

```bash
ssh -i "$ALIYUN_SSH_KEY_PATH" -p "$ALIYUN_SSH_PORT" root@"$ALIYUN_SSH_IP"
```

推荐在 `~/.ssh/config` 中配置别名，之后直接 `ssh aliyun` 登录：

```ssh-config
Host aliyun
    HostName <ALIYUN_SSH_IP，见 backend/.env>
    Port 22
    User root
    IdentityFile <ALIYUN_SSH_KEY_PATH，见 backend/.env>
```

服务器上的项目根目录即 `{project}`（部署脚本默认为 `/usr/local/compose`）。

# 快速部署说明（概览）

本项目使用 Docker Compose 管理以下服务：
- Nginx（用于托管前端静态文件和反向代理）
- MongoDB（数据存储）
- Backend（Express + Node.js API）

下文给出推荐的步骤与注意事项，分为前端、后端、Nginx、以及运行与更新策略。

## 一键打包与部署脚本

本仓库提供以下脚本：

- `script/build.bat`：在本地 Windows 开发环境执行一键打包。
- `script/install.sh`：在服务器上对解压后的产物执行部署。

### 本地打包

```bat
script\build.bat [--output .\tmp\release] [--artifact backend,conf] [-Abc] [--keeptmpfile]
```

说明：

- 默认输出目录为 `tmp/build/`
- 默认打包 `backend,frontend,conf`
- `--artifact` 可用 `-A` 代替，例如 `-Ab` 表示仅打包 `backend`，`-Abfc` 表示打包 `backend,frontend,conf`
- `--help`、`-H` 用于显示打包脚本用法
- 打包结果为 `build.tar.gz`
- 若传入 `--keeptmpfile`，会保留 `target/` 临时目录，便于检查打包内容

打包后的目录结构如下：

```text
build.tar.gz
target/
	backend/
	frontend/
	conf/
	install.sh
```

归档包解压后应直接得到：

```text
backend/
frontend/
conf/
install.sh
```

### 服务器部署

先将 `build.tar.gz` 上传到服务器并解压，然后在解压目录中执行：

```bash
sh install.sh [--outputdir /usr/local/compose] [--artifact backend,frontend,conf]
```

说明：

- `--outputdir` 默认值为 `/usr/local/compose`
- `--artifact`、`--include` 默认值均为 `backend,frontend,conf`
- `-A`、`-I` 分别是 `--artifact`、`--include` 的短参数
- `--help`、`-H` 用于显示脚本用法
- 脚本会先检查当前解压目录内是否包含所选的新产物；若缺失，会在删除旧目录前直接报错退出
- 脚本启动后会先检查 `docker` 与 `docker compose` 是否可用；若缺失，会尝试自动安装后再继续部署
- 自动安装需要 root 权限；若当前用户不是 root，则需要服务器已安装 `sudo`
- 部署前会先将已有目录备份到 `{project}/bak/`
- `backend` 备份为 `data.bak.{datetime}.zip`
- `frontend` 备份为 `www.bak.{datetime}.zip`
- `conf` 备份为 `conf.bak.{datetime}.zip`

## 前置要求

- 建议服务器具备 root 权限或可用的 `sudo`，以便 `install.sh` 在缺少 Docker / Docker Compose 时自动安装依赖。

- 如果你希望手动预装 Docker 和 Docker Compose（或 Docker Engine + Compose 插件），例如基于 Debian/Ubuntu：

```bash
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io
apt-get install -y docker-compose-plugin
```

- 确保有权限创建网络与卷，且目标端口（80/443/3001 等）未被占用。

## 环境变量与敏感信息

项目通过环境变量保存敏感信息及一些配置。环境变量保存在 `{project}/.env` 文件中。格式如下：

```
MONGODB_ROOT_PASSWORD=<your-mongodb-root-password>
LONGCAT_API_KEY=<your-longcat-api-key>
ZAI_API_KEY=<your-zai-api-key>
OPENROUTER_API_KEY=<your-openrouter-api-key>
DEEPSEEK_API_KEY=<your-deepseek-api-key>
CHAT_AUTH_SECRET=<your-auth-secret>
ALIYUN_SMTP_HOST=<your-smtp-host>
ALIYUN_SMTP_PORT=465
ALIYUN_SMTP_SECURE=true
ALIYUN_SMTP_USER=<your-smtp-user>
ALIYUN_SMTP_PASS=<your-smtp-password>
ALIYUN_SMTP_FROM=<your-from-address>
```

环境变量包括以下内容：

| key | 值类型 | 说明 |
|- |-|-|
| MONGODB_ROOT_PASSWORD | string | MongoDB root 用户密码，首次启动时用于初始化数据库 |
| LONGCAT_API_KEY | string | 美团 LongCat ApiKey |
| ZAI_API_KEY | string | 智谱 API KEY|
| OPENROUTER_API_KEY | string | OPENROUTER API KEY |
| DEEPSEEK_API_KEY | string | DeepSeek API Key |
| CHAT_AUTH_SECRET | string | 登录态签名密钥 |
| ALIYUN_SMTP_HOST | string | SMTP 服务器地址 |
| ALIYUN_SMTP_PORT | number | SMTP 端口 |
| ALIYUN_SMTP_SECURE | bool | SMTP 是否启用 TLS/SSL |
| ALIYUN_SMTP_USER | string | SMTP 用户名 |
| ALIYUN_SMTP_PASS | string | SMTP 密码或授权码 |
| ALIYUN_SMTP_FROM | string | 注册邮件发件人 |

后端运行时日志开关与模型配置不再依赖环境变量：

- `{project}/conf/backend/backend.conf` 控制后端打印行为
- `{project}/conf/backend/models.json` 为优先模型配置
- `{project}/conf/backend/identities/` 存放智能体种子 md 文件，容器内映射为 `/app/config/identities/`
- 若容器挂载的模型配置缺失，后端会回退到代码内置的 `backend/files/models.json`

## 前端部署（生产）

1. 在本地或 CI 中构建前端：

```bash
cd frontend
npm install
npm run build
```

2. 构建产物统一输出到 `frontend/dist`，无需再分别处理主页和 chat 页面。

> 注意：使用 `script/build.bat` 打包时，会自动把 `frontend/dist` 复制为归档中的 `frontend/` 目录；使用 `install.sh` 部署时，会将该目录内容复制到 `{project}/www/`。

## 后端部署

1. 将 `backend` 目录的源码（或构建产物）放到服务器合适位置（示例：`{project}/data/backend/`）。

2. 当前部署脚本会将打包产物中的 `backend/` 复制到 `{project}/data/backend/`。随后可以通过 `{project}/docker-compose.yml` 重建后端镜像。

3. 当前 `conf/compose/docker-compose.yml` 中 `backend` 服务使用 `build:`（从 `./data/backend/Dockerfile` 构建镜像）。因此：

	- 如果你上传了新的后端源码，必须重新构建镜像并重启服务：

```bash
docker compose -f conf/compose/docker-compose.yml build backend
docker compose -f conf/compose/docker-compose.yml up -d backend
```

	- 开发时可使用 bind-mount（将宿主 `./backend` 挂载到容器）并运行 nodemon 实现热重载，请使用专用 `docker-compose.dev.yml` 或 `Dockerfile.dev`，不要在生产使用热重载。

## MongoDB 与数据卷

- `conf/compose/docker-compose.yml` 使用名为 `mongo-data` 的卷保存数据。该卷一旦初始化，`MONGO_INITDB_ROOT_PASSWORD` 只在首次初始化时生效。若需更改 root 密码：

	- 在容器内用旧密码登录并修改密码（不丢失数据）：

	```bash
	docker compose -f conf/compose/docker-compose.yml exec mongodb mongosh -u root -p 'OLD_PW' --eval "db.getSiblingDB('admin').changeUserPassword('root','NEW_PW')"
	```

	- 或在可以接受丢失数据的情况下删除卷并重建：

	```bash
	docker compose -f conf/compose/docker-compose.yml down -v
	docker compose -f conf/compose/docker-compose.yml up -d
	```

## Nginx 部署

1. 使用 `install.sh --include conf` 时，会自动将打包产物中的 `conf/nginx/` 复制到 `{project}/conf/nginx/`。

2. 同时会将 `conf/compose/docker-compose.yml` 复制为 `{project}/docker-compose.yml`。

3. 确保 Nginx 的站点配置指向正确的前端目录和代理后端（如 `http://backend:3001`）。

## 后端配置

后端配置包括模型配置与智能体初始化种子。

使用 `install.sh --include conf` 时，会自动将打包产物中的 `conf/backend/` 复制到服务器的 `{project}/conf/backend/` 目录中。

模型配置对应的的是 `models.json`，智能体配置对应的是 `identities`。
后端通过 `/api/chat/models` 与 `/api/chat/agents` 暴露模型与智能体。

### 智能体初始化说明

- `conf/backend/identities/identities.json` 与 `conf/backend/identities/persona/*.md` 仅作为初始化种子数据。
- Backend 启动并连接 MongoDB 后，会按 `identities.json` 中的元数据和 persona 文件导入对应的 identity 记录。
- 导入策略是“仅初始化缺失记录”：当数据库中已存在同 id 的智能体时，不会被文件覆盖。
- 运行时 `/api/chat/agents`、智能体聊天人格读取、智能体会话校验都以 MongoDB 中的 agent 记录为准，而不是每次请求重新读取文件。


## 启动与重启

- 初次启动（在 `{project}` 目录下）：

```bash
docker compose -f docker-compose.yml up -d --build
```

- 仅重建并重启 `backend`：

```bash
docker compose -f docker-compose.yml build backend
docker compose -f docker-compose.yml up -d backend
```

- 检查服务状态与日志：

```bash
docker compose -f docker-compose.yml ps
docker compose -f docker-compose.yml logs -f backend
docker compose -f docker-compose.yml logs -f mongodb
```

## 更新代码（注意点）

- **生产**：建议通过 CI 构建镜像并推送到私有/公有镜像仓库，服务器通过 `docker-compose pull` 与 `docker-compose up -d` 更新容器；不要在生产使用宿主源码 bind-mount。 
- **开发**：可使用 `docker-compose.dev.yml`（示例：挂载 `./backend` 到容器并运行 `npm run dev`），实现热重载，避免每次代码更改都重建镜像。

## 常见问题与排查

- 查看 Compose 最终解析：

```bash
docker compose -f docker-compose.yml config
```

- 若 MongoDB 无法启动，检查卷与权限，查看日志：

```bash
docker compose -f docker-compose.yml logs -f mongodb
```

- 若 Nginx 未加载新前端页面，确认 `frontend/dist` 是否已重新构建，并检查 Nginx 是否已挂载该目录。
