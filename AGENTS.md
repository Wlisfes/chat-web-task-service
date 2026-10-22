# Chat Web 微服务工程规约（仓库内置版）

## 适用范围与工程基准

- 本文件已经复制到每个仓库内，独立生效；根目录 `AGENTS.md` 已废弃，不再作为开发依据。
- 用户明确点名服务、仓库或目录时，只修改点名目标；不得因共享包联动、依赖检查或关联关系擅自改动其他项目。发布共享包后，只更新用户明确要求联动的消费服务。
- `chat-web-skyline-service` 是微服务工程结构、编码格式和命名方式的基准项目（原基准 `chat-web-account-service` 已下线）。
- `chat-web-base-schema` 由本仓库内更具体的 Schema 规则和 `docs/schema-conventions.md` 管理。
- 新建服务时先复制基准工程配置，再删除不需要的业务模块；不要重新发明一套工程格式。

## 工程与工具链

- 使用 Node.js 22、Yarn 1.22.22、NestJS 11 和 TypeScript。
- `tsconfig.json`、`tsconfig.build.json`、`nest-cli.json`、`.prettierrc`、`.gitignore`、`.gitattributes` 和 `.dockerignore` 与账号服务保持一致。
- 内部源码使用 `@/*` 路径别名；同一项目不要混用多套别名前缀。
- 统一使用 4 空格、无分号、单引号、`printWidth: 140`、无尾随逗号。
- 源码和脚本使用 UTF-8；Shell、YAML、Dockerfile 提交为 LF。
- 业务源码和配置文件必须编写清晰、必要的中文注释；新增配置项必须同步说明用途，修改或格式化时必须保留既有注释，不得删除、覆盖或改写；注释中不得出现真实密码、Token、私钥等敏感信息。
- 仓库 `.gitattributes` 必须用 `* text=auto` 配合 `*.ts`、`*.cjs`、`*.json`、`*.md` 等 `eol=lf` 固定行尾，`.prettierrc` 显式声明 `"endOfLine": "lf"`；Git 安装默认的 system 级 `core.autocrlf=true` 会把工作区检出成 CRLF，导致本地 `format:check` 报出与 CI 不一致的假失败。克隆或修改行尾规则后如需修正已检出文件，删除 `src`、`test`、`scripts` 目录再 `git checkout --` 重新检出即可，不要用 `prettier --write` 批量改写无关文件。

## 目录与文件命名

- 通用入口固定为 `src/main.ts` 和 `src/app.module.ts`。
- 业务模块放在 `src/modules/<module-name>/`。`health`、`feign`、`database` 三个基础设施模块必须提取到 `src/` 一级目录（`src/health/`、`src/feign/`、`src/database/`），不要放进 `src/modules/`。后续改造其他 NestJS 服务时必须与 Skyline 保持同一目录级别。若某服务当前没有其中某个模块，不要为对齐而空建目录。
- 文件名使用小写 kebab-case，并使用职责后缀：
    - `*.module.ts`
    - `*.controller.ts`
    - `*.service.ts`
    - `*.middleware.ts`
    - `*.interface.ts`
    - `*.constants.ts`
    - `*.options.ts`
- 一个模块的接口、常量和配置构造分别放入对应后缀文件，不与实现类混放。
- 自动化测试放在仓库根目录 `test/`，文件名与模块目录一致并使用 `<module>.test.cjs`。禁止引入 Jest 或 `*.spec.ts`。禁止提交生成目录、依赖目录和真实 `.env`。

## TypeScript 与 NestJS 命名

- 类、接口、类型、枚举和装饰器使用 PascalCase。
- 变量、函数、方法、参数和实例属性使用 camelCase。
- 常量和注入 Token 使用 UPPER_SNAKE_CASE。
- 环境变量使用 UPPER_SNAKE_CASE，并优先添加所属服务或模块前缀，例如 `SKYLINE_*`、`GATEWAY_*`。
- NestJS 类使用明确职责后缀，例如 `SkylineService`、`GatewayController`、`NacosModule`。
- 禁止无意义的导出别名，例如 `export { TbSkylineUser as tbSkylineUser }`。
- 日志、校验消息、Swagger 描述和面向维护者的错误信息使用中文；代码标识符使用英文。

## 模块边界

- 网关只负责统一入口、路由、认证基础能力、限流、日志和服务发现，不连接业务数据库。
- 业务服务独立管理数据库连接；TypeORM 必须保持 `synchronize: false` 和 `migrationsRun: false`，数据库和表结构由外部 Schema SQL 管理。
- TypeORM Entity、完整字段 DTO 和表 SQL 统一由 `chat-web-base-schema` 管理，业务服务只安装并使用该包。
- 数据库和表由外部 SQL 创建或变更，服务启动过程不得自动建表或改表。
- 本地运行和 Docker 部署的环境都是测试环境，Schema 增量 SQL（`sql/changes/*.sql`）可以直接在对应测试库执行，不需要等待人工确认；执行前确认连接的是本服务测试库，执行后核对表结构并在汇报中说明已执行的 SQL 文件。
- Nacos 相关代码统一位于 `src/modules/nacos/`，配置项命名在所有服务中保持一致。
- 所有公开微服务路由和跨域白名单统一维护在 Nacos `chat-web-gateway-service.yaml`；新增服务必须追加 `gateway.routes`，不在网关源码中硬编码新代理。
- Nacos 配置中的 `gateway.cors.allowedOrigins` 使用完整 HTTP(S) Origin，禁止填写带路径的 URL；生产环境不得使用 `*`。

## HTTP 接口与日志

- Controller 只使用 `GET`、`POST`；禁止 `PUT`、`PATCH`、`DELETE` 和 `/:uid`、`/:keyId` 等路径参数。
- `GET` 只通过 `query` 接收入参，`POST` 只通过 `body` 接收入参；入参字段超过 3 个时必须使用 `POST` 和 `body`。
- 多选配置必须使用数组字段并通过 `POST` `body` 传输，禁止逗号分隔字符串。
- 分页接口统一使用 `page`（从 1 开始）和 `size`（默认 50、最大 100），响应统一使用 `page`、`size`、`total`、`list`；禁止使用 `pageSize`、`items`、`records` 或 `rows` 作为同义字段。
- 路由使用单数业务模块和动作式后缀，例如 `user/resolver`、`user/column`、`role/update/menu`；Controller 方法使用与 `nest-platform-service` 一致的 `httpBase<Service><Action><Resource>` 风格。
- 服务间 Feign 查询接口必须同时提供单条和多条两个版本：单条命名为 `httpBase<Service><Resource>Resolver`，路由 `/<resource>/resolve`，入参使用单个主键（如 `{ keyId }`、`{ uid }`），返回单个对象，记录不存在时抛 `NotFoundException`；多条命名为 `httpBase<Service>Column<Resource>Resolver`，路由 `/<resource>/column/resolve`，入参使用主键数组（如 `{ keyIds }`、`{ uids }`），单次上限 100 个，返回数组，不存在的主键直接忽略。两个接口返回同一个摘要类型，并在 Schema 的 Feign 契约、客户端、服务端实现和测试中同步补齐；列表回显统一通过 Schema `feign-<service>.utils.ts` 中的 `append<Service><Resource>Options` 工具调用多条接口。基准为 `httpBaseSkylineUserResolver`/`httpBaseSkylineColumnUserResolver`、`httpBaseFinanceBrandResolver`/`httpBaseFinanceColumnBrandResolver`。
- 管理端 `src/api/**/modules/*.service.ts` 必须保持为干净的传输层：接口函数接收与后端协议一致的类型，只负责发起请求并原样传递 `query`/`body`，禁止在 API 层做参数归一化、字段改名、默认值注入、类型转换、响应映射或响应包装。
- 管理端页面字段与接口字段不一致时，转换、兼容和业务默认值必须放在页面/业务域层（如 composable、store 或业务 service）；不得在 API 文件中增加私有转换函数、Adapter 或隐式适配逻辑。服务端协议转换应放在 DTO/业务层。
- HTTP 业务服务统一接入 `chat-web-base-schema` 的请求上下文中间件和请求日志中间件：`main.ts` 中先注册 `requestContextMiddleware`，再注册 `createRequestLoggingMiddleware(process.env.NACOS_SERVICE_NAME)`，与网关输出相同格式的请求日志，通过同一日志ID与网关日志串联。
- Docker Compose 统一使用 `json-file` 日志驱动，单文件最大 `20m`、保留 `30` 个文件；排障和轮转验证命令写入各服务 `deploy/RUNBOOK.md`。

## NestJS 业务接口编码基准

- `chat-web-skyline-service/src/modules/sheet/` 和 `src/modules/organization/` 是菜单、组织模块的 Controller、Service、DTO、Utils Service 与 Module 组织方式基准；下列规则必须完整写入每个 NestJS 仓库自己的 `AGENTS.md`，不得只依赖本工作区文件。
- Controller 必须保持为薄协议层：只声明路由、权限、Swagger/Apifox 元数据，接收 `query`、`body`、当前身份或必要请求/响应上下文，并将参数原样交给同名 Service 方法；禁止解构/改名业务参数、补业务默认值、拼装业务响应、访问 Repository 或编写业务判断。设置 Cookie、响应头、重定向和流式响应等纯 HTTP 协议操作可以保留在 Controller。
- Controller 与对应 Service 的公开接口方法必须统一使用 `public async`，并采用 `httpBase<Service><Action><Resource>` 命名；两层方法名必须完全一致。Controller 不得调用 `create`、`list`、`findOne`、`update` 等另一套简写方法名。
- Controller 的 `GET` 只接收 `@Query()` DTO，`POST` 只接收 `@Body()` DTO；局部变量使用 `query`、`body` 或 `input` 等能够准确表达来源的名称，无请求 DTO 的接口不制造空 DTO。每个接口都必须使用 `ApiServiceDecorator` 完整声明请求来源、请求 DTO、响应 DTO、数组标识和中文说明。
- Service 负责业务编排和事务边界，公开接口方法必须添加简洁中文职责注释并显式声明 `Promise<...>` 返回类型；入参优先接收完整 DTO，不得要求 Controller 拆字段或做协议转换。DTO 在 Service 中统一使用 `import * as XxxDto` 归组引用。
- 分页查询统一返回 `PageResult<Entity>`，使用 `DataBaseService.builder` 构造 QueryBuilder，别名统一为 `t`；筛选、排序、分页和 `getManyAndCount` 应在同一 builder 回调内清晰完成。禁止在业务模块重复封装 QueryBuilder 或创建无意义 Repository Adapter。
- 可复用的实体查找、存在性校验、唯一性校验、树校验、锁表等工具逻辑放入同模块 `<module>.utils.service.ts`，使用 `@Injectable()` 并由 Module 注册注入；主 Service 只保留用例编排。不得把仅调用一次且没有复用价值的简单业务步骤机械拆成工具类。
- 多步写操作、唯一性检查、层级结构调整和关联关系替换必须由 Service 明确建立事务；需要并发保护时通过 Utils Service 锁定相关数据，再执行校验和写入。
- 普通业务入参中可选字段的空值判断统一使用 `class-validator` 的 `isEmpty`、`isNotEmpty`；禁止编写 `input.xxx !== undefined && ...` 或用隐式 truthy/falsy 代替该类入参判空。只有必须区分“字段未传”和“显式传入 null”的三态更新字段可以直接判断 `undefined`，且必须保留该语义说明；实体查询结果、基础设施配置解析、布尔值判断、枚举比较和两个已确认非空值之间的相等性比较不受此限制。
- DTO 必须放在模块 `dto/` 目录，优先通过 `PickType`、`PartialType`、`IntersectionType` 复用 `chat-web-base-schema` DTO；分页 DTO 继承公共 `PageDto`。字段必须具备 Swagger 示例/说明、必要的类型转换和中文校验消息。
- Module 按 `imports`、`controllers`、`providers`、`exports` 组织；新增 Utils Service 必须注册到 `providers`。不得改变既有公开路由、权限、响应结构和业务语义来迎合代码格式。

## 源码导入、目录与测试落地规则

改造其他 NestJS 服务时必须按本节和上一节执行；基准代码为 `chat-web-skyline-service` 的 `src/modules/sheet/`、`src/app.controller.ts`（健康检查）、`src/feign/`、`src/database/` 和 `test/*.test.cjs`。

### 目录分层

- 业务模块只放 `src/modules/<module-name>/`，每个模块包含：`<name>.module.ts`、`<name>.controller.ts`、`<name>.service.ts`、按需 `<name>.utils.service.ts`、`dto/<name>.dto.ts`。
- `health`、`feign`、`database` 三个基础设施模块必须提取到 `src/` 一级目录：`src/health/`、`src/feign/`、`src/database/`。不要放进 `src/modules/`。后续改造其他服务必须与 Skyline 保持同一目录级别。若某服务当前没有其中某个模块，不要为对齐而空建目录。
- 禁止保留一次性迁移脚本、菜单种子和 `repair-*`。部署需要的 CLI 仅允许 `src/cli/nacos-auth.ts`、`src/cli/isolate-service-databases.ts`、`src/cli/apply-schema.ts`。
- 隔离脚本只读取本服务 Nacos Data ID、只连接本服务数据库；禁止读取或连接其他服务的 Nacos Data ID。

### 导入顺序与来源

每个文件顶部导入按以下顺序。禁止 `from 'typeorm'`；禁止从 `@nestjs/typeorm` 导入 `InjectRepository`、`Repository`、`EntityManager`（`TypeOrmModule` 除外）。

1. `@nestjs/common`、`@nestjs/config`、`@nestjs/swagger` 等 Nest 官方包。
2. `@wlisfes/chat-web-base-schema/decorator`
3. `@wlisfes/chat-web-base-schema/auth`
4. `@wlisfes/chat-web-base-schema/database`
5. `@wlisfes/chat-web-base-schema/utils`
6. 其他 schema 子路径（`feign`、`nacos`、`filters`、`interceptor` 等）。
7. 本仓库 `@/modules/...`、`@/health/...`、`@/feign/...`、`@/database/...`。
8. `import * as Schema from '@wlisfes/chat-web-base-schema'`。Service 和实体较多的 Utils 用此归组引用实体。
9. `import * as <Module>Dto from '@/modules/<module>/dto/<module>.dto'`。

补充约定：

- Controller：共享响应实体 DTO 可具名导入 `TbXxxDto`；本模块请求与响应 DTO 一律 `import * as XxxDto`。
- Service：`InjectRepository`、`Repository`、`DataBaseService`、`Brackets`、`In`、`EntityManager` 从 `@wlisfes/chat-web-base-schema/database` 导入；`isEmpty` / `isNotEmpty` 从 `@wlisfes/chat-web-base-schema/utils` 导入。
- DTO 文件：`@nestjs/swagger` → `class-transformer` / `class-validator` → schema `decorator` / `utils` → `import * as Schema`，字段用 `PickType(Schema.TbXxxDto, ...)`。
- Module：`TypeOrmModule` 从 `@nestjs/typeorm` 导入；有数据库的服务使用 `TypeOrmModule.forFeature(本服务 ENTITIES 常量)`，不要在业务 Module 里逐个罗列实体。
- 从同一 interface、dto、schema 或类型定义模块具名导入的标识符超过 3 个时，一律改为 `import * as XxxDto from ...` 命名空间导入（仅类型用途时使用 `import type * as XxxTypes from ...`），别名沿用 `<领域>Dto`、`<领域>Types`、`Schema` 等既有风格；`@nestjs/*`、`class-validator`、`class-transformer`、`typeorm` 等框架装饰器和校验器无论数量多少一律保持具名导入，禁止写成 `Nest.Injectable()`、`Validator.IsString()` 这类命名空间调用。

### 测试文件

- 使用 Node 内置测试运行器。文件放在 `test/<module>.test.cjs`，名称与模块目录一致。
- `yarn test` 为 `yarn build && node --test test/*.test.cjs`（或仓库现有等价脚本）。测试引用 `dist/` 编译产物。
- 禁止引入 Jest，禁止 `*.spec.ts`，禁止与模块无关的测试文件名。同一模块的用例合并到一个测试文件。

### 数据范围资源编码

- 功能权限码与数据范围资源编码分离。权限码用于 `@RequirePermissions`。
- 数据范围 `resourceCode` 格式固定为 `chat:{服务}:{资源}`，全小写，例如 `chat:skyline:user`、`chat:crm:consumer`、`chat:finance:voucher`。`*` 表示默认规则。
- 只有使用了 `@RequirePermissions` 的接口才会请求 `/feign/auth/permission/authorized-principal`。多个权限码为或关系；传入 `*` 时跳过权限校验，但仍查询当前用户的角色与数据权限。未使用该装饰器的接口不得调用该 Feign。
- 权限校验通过后，Auth 返回的 `superAdmin`、`roleCodes`、`all`、`items` 由 `AuthorizationGuard` 挂到 `request.user`，业务代码从 `CurrentPrincipal` 读取，不得再调用 `hasPermission` / `isSuperAdmin` / `resolveDataScope`，也不得再请求 `/permission/check`。

## Git 提交规范

- 所有提交信息必须使用 Conventional Commits 类型前缀，格式固定为 `<type>: 中文摘要`；如需填写作用域，使用 `<type>(<scope>): 中文摘要`。
- `type` 只能使用以下类型：`init`（项目初始化）、`feat`（添加新特性）、`fix`（修复缺陷）、`docs`（仅修改文档）、`style`（仅调整格式或样式）、`refactor`（代码重构）、`perf`（性能优化）、`test`（增加或调整测试）、`build`（构建或依赖变更）、`ci`（持续集成或部署配置）、`chore`（工程工具或其他维护性变更）。
- 提交摘要、正文和脚注必须使用中文；类型前缀保留上述英文小写关键字，代码标识符、命令和版本号可按实际需要保留原文。
- Agent 完成代码修改后默认不得执行 `git commit`，改动保留在工作区供用户 review；只有用户明确说出“提交”“commit”或等价表述时才允许提交，且授权只对当次请求有效。不得因改动较小、验证已通过或为了汇报方便而自行提交。
- 用户说“提交代码”“提交”或等价表述时，含义是提交并推送到远程仓库：在当前业务分支（通常为 `developer`）执行 `git commit` 后必须紧接着 `git push origin <当前分支>`，不得只停留在本地 commit；“提交”不等于“发布”，不得因此执行 `npm run deploy`/`yarn deploy`、合并 `main` 或触发部署流水线。
- 每个提交应聚焦单一目的，摘要使用动词开头并准确说明影响范围，禁止使用 `update`、`modify` 等无意义描述或整句英文提交信息。
- 示例：`feat: 新增客户归属人筛选`、`fix: 修复 Nacos 服务注册失败`、`docs: 补充部署回滚说明`。
- 日常开发在 `developer` 分支进行；`main` 只接收来自业务分支的合并，不直接提交。
- 发布统一执行 `npm run deploy`：同步远端、按需递增版本号、推送当前分支、创建或复用指向 `main` 的 PR 并合并、再把当前分支快进到 `main`。不得手工拆成多条命令执行。
- 版本号由发布脚本维护：当前 `package.json` 版本号已经存在于 `main` 时递增补丁号并生成 `chore(release): vX.Y.Z` 提交；上一次发布失败、版本号尚未进入 `main` 时沿用同一版本号重试，不得因反复发布把版本号越推越高。
- 快进这一步不可省略。GitHub 的 Merge commit 会在 `main` 上新建一条合并提交，当前分支指针不会移动；不快进就会一直显示 behind，其他设备在同一分支上同步不到最新代码。
- `npm run deploy` 在 `main` 分支或工作区有未提交改动时直接失败；最后的快进只做 fast-forward，不产生新的合并提交，也不会改动文件。
- 禁止为了消除分支落后提示而把 `main` 反向合并进业务分支产生多余的合并提交。

## 配置、文档与部署

- Company 部署机和 `chat-server-company` Runner 已废弃；所有 Docker 服务只部署到当前主机 `chat-home-server`，不得再为 Company 创建部署任务、矩阵项或恢复等待队列。
- GitHub Actions 的 Self-hosted Runner 选择标签统一使用 `chat-home-server`，部署环境继续使用 `production-home`；每个仓库仍使用独立 Runner 注册和独立 `/opt/<repository-name>` 部署目录。
- 流水线只构建并发布一次完整 Git SHA 镜像，然后部署到 `chat-home-server`；不得保留无实际目标的多机器部署矩阵。
- `chat-home-server` 上的部署必须执行容器健康检查、部署后端点验证和失败自动回滚；历史废弃机器的配置仅作为变更记录保留，不得作为当前运行基线。
- 每个环境变量都必须同时写入 `.env.example`；部署变量还要写入 `deploy/.env.example` 并提供中文说明。
- `.env.example` 只作为配置项清单，值使用稳定示例或明确占位符；只要求配置项不缺失，不得为了同步某台机器的 Namespace ID、端口或其他真实运行值而反复修改示例文件。
- `.env.example` 只保留连接 Nacos 所必需的启动参数和当前机器特有的覆盖项；端口、业务连接、路由、跨域、限流、超时、发现分组及服务名称放入对应 Nacos YAML。
- 真实密钥、Token 和生产 `.env` 不得提交；构建密钥使用 BuildKit Secret 或 GitHub Actions Secret。
- 每个服务提供 `/health`，容器健康检查优先使用不依赖下游服务的 `/health/live`。
- 每个 HTTP 服务提供 Swagger；公开路由、环境变量和部署方式必须同步更新 README。
- Docker 容器使用非 root 用户；所有业务服务归属同一个 `chat-web-service` Compose 项目并接入 `chat-web-infrastructure` 外部网络。
- 各服务由独立 Compose 文件部署时禁止使用 `--remove-orphans`，避免部署一个服务时删除同组的其他微服务。

## 代码验证与分支规则

- 日常开发使用 `developer` 分支；新服务合并到 `main` 后触发构建部署流水线。
- 远程仓库只保留 `main`、`developer` 两个长期分支；需求开发使用的临时分支必须先合并到 `developer`，发布时同步合并到 `main`，两边合并并验证通过后立即删除临时分支（远程和本地），不得保留其他长期或已完成分支。
- 单个小功能、样式调整或普通缺陷修复完成后，只提交并推送到 `developer`，不得立即合并 `main` 或触发构建部署流水线；应累计一批已完成且验证通过的改动后统一发布。只有用户明确要求发布/部署，或确属需要立即上线的紧急修复时，才允许单独合并 `main` 并触发流水线。
- 至少执行格式检查、TypeScript 类型检查和 Nest 构建。
- 涉及代理、数据库、服务发现或部署时，必须增加对应的运行级验证。
- 修改公共工程规约时，同步检查所有现有微服务，避免只修新项目而留下配置分叉。

## 版本号与发布

- `package.json` 的 `version` 是本仓库唯一维护的发布版本号，格式固定为 `MAJOR.MINOR.PATCH`。
- 日常开发、缺陷修复和合并 `developer` 时不得改动 `version`。
- 发布和部署必须由用户明确指令触发。用户未明确要求发布时，Agent 只能修改工作区代码（用户明确要求提交时才可提交并推送当前业务分支到远程），不得执行 `npm run deploy`、不得在未要求提交时推送 `developer`、不得创建或合并 PR、不得修改 `version`、不得打标签、不得触发任何部署流水线；完成改动后应汇报状态并等待用户决定是否发布。
- 「修复这个问题」「处理一下」「写入规约」这类改代码指令不包含发布授权；只有用户说出发布、部署、上线、合并 main 或等价表述时才视为授权，且该授权只对当次请求有效，不得延续到后续请求。
- 用户授权范围内的仓库才允许发布。不得因为存在依赖联动就自行扩大到其他仓库，确有联动需要时先向用户说明再等待确认。
- 只有用户明确要求发布/部署并合并 `main` 时才变更版本号。每次发布必须自增一个修订号（小版本），规则与 `chat-web-base-schema` 一致：
    - 以当前 `package.json` 版本和已发布版本中的较大者为基准
    - 已发布版本：共享包核对 GitHub Packages；其他仓库核对 git tag `vX.Y.Z`
    - 若当前版本尚未发布，则直接使用当前版本
    - 若当前版本已发布，则 `PATCH + 1`（例如 `1.0.0` → `1.0.1`）
    - 当 `PATCH` 达到 `99` 时进位：`MINOR + 1` 且 `PATCH` 归 `0`（例如 `1.0.99` → `1.1.0`）
    - 不得发布已经存在的版本号，不得跳号、降版本或使用预发布标签
- `chat-web-base-schema` 由 `main` 上的 Publish 流水线自动计算版本、发布到 GitHub Packages、回写 `package.json` 并打 `vX.Y.Z` 标签；Agent 不得在本地修改共享包版本号，也不得执行 `npm publish`。
- 本地联调未发布的 `chat-web-base-schema` 改动时，在 Schema 仓库执行 `yarn local:link <服务名>`（服务名可省略 `chat-web-` 前缀和 `-service` 后缀，不传则覆盖全部依赖服务），把本地构建产物复制到服务 `node_modules`；联调结束执行 `yarn local:unlink <服务名>` 恢复 `yarn.lock` 锁定的 npm 版本，`yarn local:status` 查看当前来源。禁止使用 `yarn link`、`file:`、`link:` 或修改服务 `package.json`、`yarn.lock` 引用本地 Schema，避免 `typeorm`、`@nestjs/*` 被加载两份；本地产物仅用于调试，上线前仍须发布 Schema 并在服务中升级到明确版本。
- 后端服务每次发布前必须先执行 `npm run base:update`，把 `@wlisfes/chat-web-base-schema` 升级到 GitHub Packages 上的最新版本；升级后执行该仓库规定的格式检查、类型检查、构建和测试，确认通过后再与本次改动一起提交（`package.json`、`yarn.lock` 的依赖变更不得遗漏），最后执行 `npm run deploy`。若最新 Schema 导致构建或测试失败，必须先修复或向用户说明，不得跳过升级直接发布；共享包仍在发布流水线中时，等待新版本可安装后再执行升级。
- 其他服务和管理端在合并 `main` 发布前，由 Agent 将 `package.json` 的 `version` 改为下一个修订号，提交信息使用 `chore(release): vX.Y.Z`，并同步打 `vX.Y.Z` 标签；Docker 镜像仍按 Git SHA 构建部署。

## 本仓库专属补充规约

以下规则在通用规约基础上适用于本仓库；如涉及本仓库专属边界，以本节的具体约束为准。

### 本仓库工程补充规则

- 使用 Node.js 22、Yarn 1.22.22、NestJS 11 和 TypeScript；源码使用 UTF-8，Shell、YAML 和 Dockerfile 使用 LF。
- 统一使用 4 空格、无分号、单引号、`printWidth: 140`、无尾随逗号；内部源码统一使用 `@/*` 路径别名。
- `.prettierrc`、`tsconfig.json`、`tsconfig.build.json`、`nest-cli.json`、`.gitignore`、`.gitattributes`、`.dockerignore`、`.npmrc` 和 `.vscode/settings.json` 与 `chat-web-skyline-service` 保持一致，不得单独调整格式化或编译规则。
- 自动化测试使用 `node --test test/*.test.cjs` 并引用 `dist/` 编译产物；禁止引入 Jest、ESLint 默认脚手架配置或 `*.spec.ts`。
- 每次改动至少执行 `yarn format:check` 和 `yarn test`（包含 Nest 构建）。

### 修改范围

- 用户只点名 `chat-web-task-service` 时，只修改本仓库，不得联动修改其他消费服务；确需扩大范围时必须先获得用户明确同意。

### 当前工程边界

- 本仓库由已下线的 `chat-web-account-service` 重置而来；原账号、菜单、角色、组织功能和数据已迁移到 `chat-web-skyline-service`，不得在本仓库恢复。
- 本服务负责全部定时任务：周期任务定义、Cron 调度、执行记录、RabbitMQ 投递、失败重试和死信。定时任务已从 Skyline 迁出，Skyline 只保留管理页面接口并通过 `/feign/task` 转发。
- 只保留 Cron 周期任务；一次性任务、手动任务等类型在出现真实场景前不得新增。任务定义由 `src/modules/cron/cron.constants.ts` 的 `TASK_CRON_DEFINITIONS` 在启动时幂等写入，页面不提供新增和删除。
- 数据库只使用 `chat-web-task`（Nacos `database.chat-web-task`），表结构来自 `@wlisfes/chat-web-base-schema/chat-web-task-mysql`。task 库只保存调度定义和执行状态，执行结果只存摘要；汇率、短信记录等业务数据必须留在数据所属服务的库中。
- RabbitMQ 只使用虚拟主机 `/chat-task`（Nacos `rabbitmq` 节点），队列统一使用 `chat.task.*` 前缀；消息只携带执行记录ID，消费者回库读取详情。
- 新增任务时：在 `TASK_CRON_DEFINITIONS` 登记任务定义，在 `src/modules/cron/handlers/` 实现 `TaskHandler` 并注册到 `TASK_HANDLERS`，下游接口必须能按业务键安全重复调用，同时补充测试。
- 处理器调用其他服务统一使用共享 Feign 客户端和 `gateway.feign.service_token`，不转发用户令牌。

### 接口暴露边界

- 本服务的接口不对外暴露：业务接口只有继承 `FeignClientTaskManager` 的 `/feign/task/**` 服务间接口，由服务间凭据校验；不得新增普通 Controller 业务接口，Gateway 不得配置 `/api/task`。
- 只有首页 `/` 和 `/health/live` 不需要凭据，用于 Docker 健康检查和 Gateway 探活，不返回业务数据。
- 用户登录和按钮权限在 Skyline 校验；写操作的操作人 UID 由 Skyline 校验后作为参数传入，本服务只记录不鉴权。

### 部署边界

- 只部署到当前主机 `chat-home-server`；容器不发布宿主机端口，只在 `chat-web-infrastructure` Docker 网络中开放 5010，不得配置 `NACOS_REGISTER_IP`。
- 部署前由 `dist/cli/apply-schema-bootstrap.js` 以临时单库账号执行 Task 增量 SQL。
- 修改 Docker、端口、健康检查或部署流程时，必须同步更新 `deploy/CHANGELOG.md` 与 `deploy/RUNBOOK.md`。
- 获得用户明确发布指令前，不得向 `main` 推送、合并 PR 或运行部署流水线。
