# jdpro 维护版

基于本地留存的 `6dylan6/jdpro` 最新运行脚本继续维护。维护仓库：<https://github.com/cyuni1996/jdpro>。

2026-10-08 从青龙实际运行目录保存了 127 个源码文件，其中 51 个为根目录 JD JavaScript 任务。运行目录比留存的旧 Git 副本更新，因此以运行目录为准，没有从旧副本补回已移除的活动。初始文件哈希见 [源码基线](docs/source-snapshot.json)。

原作者包括 6dylan6、LXK9301 及各脚本作者；文件内的作者信息保持保留。[原仓库说明](docs/UPSTREAM_README.md)留作来源记录，其订阅链接已经失效，安装请使用本文。原始副本未附独立 LICENSE，旧 package.json 的 ISC 字段不作为所有收录代码的统一授权；本仓库不额外授予原代码授权。

## 青龙订阅

迁移已有安装时更新原有 `jd` 订阅，避免创建重复任务。当前部署使用以下参数：

- 链接：`https://github.com/cyuni1996/jdpro.git`
- 分支：`main`
- 别名：`6dylan6_jdpro`
- 白名单：`(^|/)(jd_|jx_|jddj_)`
- 黑名单：`backUp|(^|/)(tools|tests|docs|docker)/`
- 依赖文件：`(^|/)jd[^_]|USER|JD|(^|/)function/|sendNotify|(^|/)notify\.py$|(^|/)utils/|(^|/)package(-lock)?\.json$|(^|/)requirements\.txt$`
- 文件后缀：`js py sh`（青龙 2.20.2 使用空格分隔）
- 定时设置：沿用现有订阅的设置。
- 自动添加任务、自动删除任务：迁移已有安装时关闭，保留原任务及定时设置。
- 执行后：`python3 /ql/data/repo/cyuni1996_jdpro_main/tools/deploy_qinglong.py /ql/data/scripts/6dylan6_jdpro --install-deps`

完整参数也保存在 [订阅配置](docs/subscription.json)。执行后同步会更新原任务目录中的源码和依赖清单，保留 `BeanCache`、互助码、`function/user.js` 和其他本地配置。锁文件未变化时复用已安装的依赖；首次运行或锁文件变化时安装锁定版本，跳过 npm 安装脚本及可选图像依赖。首次拉取前备份现有脚本。

青龙 2.20.2 的表单在修改链接或分支时会重新生成“唯一值”，该字段默认禁用，可通过支持 `alias` 参数的订阅 API 保留原元数据别名。[青龙表单实现](https://github.com/whyour/qinglong/blob/v2.20.2/src/pages/subscription/modal.tsx)。实际拉取目录仍根据仓库地址和分支生成，本仓库为 `cyuni1996_jdpro_main`。因此迁移原任务需要上述执行后同步，单独保留界面别名不足以保留任务路径。首次安装可以使用自动生成的目录和任务，无需同步到旧目录。

以下命令用于手动拉取，会按仓库地址和分支生成目录名：

```sh
ql repo https://github.com/cyuni1996/jdpro.git '(^|/)(jd_|jx_|jddj_)' 'backUp|(^|/)(tools|tests|docs|docker)/' '(^|/)jd[^_]|USER|JD|(^|/)function/|sendNotify|(^|/)notify\.py$|(^|/)utils/|(^|/)package(-lock)?\.json$|(^|/)requirements\.txt$' main 'js py sh'
```

## 依赖与账号

使用 Node.js 22 或更新版本。`got` 固定为 11.8.6，保留原脚本的 CommonJS 调用方式。`ds`、`date-fns` 等关键版本取自原安装脚本和已留存的依赖清单，其余依赖由 package-lock.json 固定实际安装版本。旧 `request` 通过 npm 别名替换为 [Cypress 维护的 request 分支](https://github.com/cypress-io/request)，保留 `require('request')` 调用接口；`global-agent`、`moment` 和 `nodemailer` 更新到已修复安全问题的版本。可选图像库也更新到了 `canvas` 3.2.3、`sharp` 0.35.5，`jsdom` 改为与 canvas 3 兼容的 26.1.0。

通过青龙的终端进入拉取后的脚本目录，执行：

```sh
# 按实际挂载布局选择 /ql/data/scripts 或 /ql/scripts。
cd /ql/data/scripts/6dylan6_jdpro
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
python3 -m pip install -r requirements.txt
```

使用根目录 package.json 声明的本地依赖时，Node 会优先加载同目录的 node_modules。`sharp` 与 `canvas` 为需要图像处理功能时才安装的可选依赖，实际安装取决于青龙容器的系统库；未安装时这些功能仍可能不可用。旧 `jd_indeps.js` 作为原始脚本保留，迁移时优先使用上面的安装命令，避免旧安装脚本改写全局仓库源与全局依赖。

在青龙「环境变量」中配置 `JD_COOKIE`，多个账号可分别建变量；合并值支持换行和 `&`，也支持混合使用。凭据只保存在青龙环境变量中。通知设置参考 [通知说明](notify.md)。可选的 `function/user.js` 是本地配置文件，已加入 Git 忽略规则。

## 首轮修复

- `ALLOWPIN` 匹配当前任务但没有找到对应账号时，运行账号列表保持为空。
- `BANPIN`、`ALLOWPIN` 按完整 `pt_pin` 匹配，支持中文、URL 编码、多个任务分组。
- Cookie 的换行、`&`、空白与重复值统一处理；格式错误提示仅显示账号序号。
- `DP_POOL` 未指定 `PERMIT_JS` 时按原说明对所有任务启用代理池；代理加载改用新版 `global-agent.bootstrap()` 入口。
- 修复 `function/sendNotify.js` 对 USER_AGENTS.js 的错误相对路径。
- 增加包清单、锁文件、静态检查、Cookie 与依赖兼容性回归测试和 GitHub Actions。
- 替换停更的 request 依赖，更新存在已知漏洞的代理、日期和邮件依赖。
- 发布内容排除了账号缓存、互助码、数据库、认证文件与推送配置，通知文档里的令牌示例已替换为占位符。

## 检查与维护范围

全量维护的逐项状态、受控验证、修复证据与每日维护规则见 [维护记录](docs/maintenance.md)。完整清单覆盖 51 个任务、互助 Shell 与公共依赖；尚未实测和认证阻塞的项目明确保留，不宣称全部恢复可用。

```sh
npm ci --ignore-scripts --omit=optional --no-audit --no-fund
npm run verify
```

检查会解析 JavaScript、Python、Shell、JSON，核对明确的本地导入和依赖声明，并检查发布目录是否混入凭据与运行数据。回归测试使用虚构账号，验证本地 Cookie 处理、代理初始化、回调请求与本地通知生成。GitHub Actions 执行这些检查。2026-10-08 首次发布前，15 项回归测试全部通过，完整锁定依赖的 `npm audit` 报告为零已知漏洞；这不代表任务接口或活动状态已经恢复。

原任务包含混淆代码、动态加载与青龙宿主环境的条件导入，静态检查不能确认全部接口仍然可用。基线日志中，汪汪庄园任务出现 `undefined.length` 错误，汪汪庄园合成出现 `null.activityJoyList` 错误，部分抽奖活动返回已过期。这些任务的接口和活动状态尚待逐项实跑验证，本轮不宣称恢复了全部活动。

后续报错请提供任务文件名、运行时间和去除 Cookie、账号标识、地址及通知密钥后的错误片段。明确活动已结束的任务应在青龙中停用；接口变更应提交独立修复并补充对应响应测试。
