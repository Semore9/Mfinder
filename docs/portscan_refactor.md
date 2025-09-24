# 端口扫描重构路线

## 阶段 0：环境评估与前置准备

### 运行环境快照
- 宿主：WSL2 (Linux Sangfor 6.6.87.2-microsoft-standard-WSL2)
- 架构：amd64
- Go 版本：1.24.1
- 当前项目：`mfinder`，Go + Wails 前端

### 原始报文能力评估
- WSL2 支持原始套接字，但需要 `CAP_NET_RAW` 或 root 权限。
- Windows 防火墙对 WSL 网络有影响，需确认是否允许大规模发包；必要时在宿主层创建测试网段或使用回环网段验证。
- 若需要抓包，推荐安装 `libpcap`/`tcpdump`，或使用 Go 的 `AFPacket`/`raw socket`，免去额外依赖。

### 候选库/方案
| 方向 | 方案 | 优劣势 |
| ---- | ---- | ------ |
| 发包 | Go 原生 `syscall.RawConn` / `golang.org/x/net/ipv4` | 纯 Go，跨平台好；需自行实现以太网帧，Windows 支持有限 |
| 发包 | [gopacket/layers + `afpacket`/`pcap`](https://github.com/google/gopacket) | 成熟、解析层丰富；Linux 下通过 `afpacket` 性能好，但在 Windows/WSL2 需额外依赖 |
| 发包 | 外部工具（masscan/nmap）二次封装 | 快速验证，但无法实现“自研”目标 |
| 收包 | `gopacket/afpacket` | 零拷贝，适合高吞吐；需要 root |
| 收包 | `pcap` via gopacket | 通用但增加 libpcap 依赖 |

**初步决定**：优先选择 `gopacket + afpacket` 路线，Linux/WSL 下无需额外库即可使用；后续再评估 Windows 原生支持。

### 原型验证计划
1. 使用 `gopacket` 在 WSL2 下构造 TCP SYN 报文，向本地/局域网主机指定端口发包。
2. 通过 `afpacket` 抢占模式监听回包，匹配 SYN/ACK，验证性能与权限需求。
3. 衡量在 1 台机器上 1 秒内可发送/接收的报文数量，记录 CPU/内存占用。

### 安全与权限
- 需要具备 `sudo` 权限或为 `mfinder` 可执行文件添加 `CAP_NET_RAW` 与 `CAP_NET_ADMIN`。
- 建议在开发阶段使用非特权端口/测试环境，防止误触内网 IDS。

### 阶段 0 交付目标
- 文档化环境状况、依赖与权限需求。
- 落地一个最小化 demo（发一个 SYN，收到 SYN/ACK）用于后续开发基准。
- 明确下一阶段（阶段 1）接口抽象与任务配置的改造范围。

## 下一阶段展望
- **阶段 1：扫描接口抽象** —— 定义统一的 `PortProber`，Manager 仅依赖新接口，接入初版无状态探测器框架。
- **阶段 2：无状态发包原型** —— 实现并行发包、回包监听与状态表。
- **阶段 3：精度增强** —— 二次验证、重发策略、Stop/Cancel 支持。
- **阶段 4：指纹体系** —— 规则仓库、指纹采集解耦。
- **阶段 5：被动数据** —— FOFA 等数据源融合。

后续阶段将在此文档持续记录决策、依赖与测试结论。

## 阶段 1：扫描接口抽象（进行中）

### 已完成内容
- 在 `backend/portscan` 中新增 `PortProber` 接口与 `ProbeOptions` 结构，统一未来所有扫描实现的对外契约。
- 新增 `backend/portscan/stateless.Prober`，当前版本仍基于 TCP 连接，后续阶段会替换为真正的无状态原始报文实现。
- `Manager` 仅依赖 `PortProber`，扫描流程通过通道获取探测结果，为后续替换底层引擎、引入速率限制器打下基础。
- 统一超时计算入口 `effectiveTimeout`，方便根据任务/全局配置推导超时值。

### 待办事项
- 在阶段 2 替换 `stateless.Prober` 的实现，改为原始报文发包 + 回包匹配。
- 引入速率控制、状态表、重发等机制，并在 `ProbeOptions` 中扩展所需参数。

## 阶段 2：无状态发包原型（规划中）

### 目标
- 构建独立的原始报文发包/收包引擎，支持发送 TCP SYN / UDP 探测包并捕获响应。
- 实现轻量级状态表：记录 cookie、发送时间、重试次数，便于回包匹配与超时管理。
- 定义回包事件结构，明确 SYN/ACK、RST、ICMP 等分类，为后续“开放/疑似开放”判定打基础。

### 当前进度
- 在 `backend/portscan/stateless/engine.go` 接入 Linux 原始套接字（`AF_INET` + `IP_HDRINCL`），实现 SYN 发包、TCP/ICMP 回包解析及 cookie 匹配。
- `stateless.Prober` 现通过状态表管理 inflight 探测、汇聚 `ProbeEvent`，并支持按端口、上下文取消、超时回收。
- 若运行环境缺少 `CAP_NET_RAW`/root 权限，会回落到 `DisabledProber` 并给出“stateless prober unavailable”错误提示，提醒用户以特权方式运行。

### 技术要点
- **Cookie 设计**：采用 HMAC(IP|Port|Proto|Ts|Nonce) 的 32bit 截断，拆分到 TCP ISN、UDP 源端口等字段；设置 Δt 有效期。
- **收包架构**：Linux 使用 AF_PACKET + TPACKETv3 + fanout；Windows/macOS 使用 pcap + 多协程；Go 层采用多 shard 结果缓冲。
- **状态表**：按 IP/端口/协议分片存储，利用 `sync.Pool` 复用节点；维护 `sentAt`、`retry`、`status`。
- **误报控制**：对 RST/SYN-ACK/ICMP 做分类，UDP 结合 ICMP Port Unreachable 判定 `closed`/`filtered`；对可疑端口触发二次验证。

### 下一步实施
1. 完成 `packetEngine.Start/Close/SendBatch/Results`，整合 gopacket/afpacket，实现基本的发包与回包轮询。
2. 设计 `stateTable` 结构，记录 cookie 与超时；结合 `ProbeOptions.RateLimit` 做节流。
3. 将 `stateless.Prober` 切换到原始报文模式，返回 `ScanResult`（开放/疑似/失败）。
4. 编写基准工具，评估发包 PPS、回包丢失率、内存占用。

## 阶段 3：状态增强与精度控制（规划中）

### 目标
- 扩展状态表：记录探测历史、丢包/ICMP 情况，支持 StopTask 时的即时清理。
- 引入二次验证机制：对疑似开放的端口发起 SYN→SYN/ACK→RST 的轻量握手确认。
- 实现统一的取消/退出流程，使发包、回包、验证线程共享同一 context。
- 添加自适应速率调节，依据回包统计动态调整发包速率（基础 AIMD）。

### 设计要点（草案）
- **状态表分片**：按目标 IP/端口哈希拆成若干 shard，减少锁竞争；状态节点包含 `sentAt`、`retry`、`phase`、`stats` 等字段。
- **二次验证**：在收到 SYN/ACK 后记录为 `tentative-open`，由验证队列负责发 RST/ACK；对同一目标配置最大并发/速率，默认关入超时失败。
- **自适应速率**：收集窗口内的 `ack_ratio`、`icmp_ratio`、`drop_ratio`、`rtt_p50/p95`，定期调整目标 PPS（例如 AIMD：成功则 +Δ，失败则 ×β）。
- **StopTask**：所有 goroutine（发包/回包/验证）监听同一 `context.Context`，退出时清空状态表并关闭结果通道。

### 实施步骤
1. 重构 `packetEngine` 引入 state shard 与 metrics 收集；对 `ProbeOptions` 增加验证策略参数。
2. 在 `Prober` 中串联验证队列与状态迁移逻辑，确保回调只触发一次。
3. 添加简单的 AIMD 调节器（可独立成组件），对发送循环提供实时速率。
4. 编写阶段性测试/基准：验证 StopTask 真正停止发包、确认二次验证行为及速率调节趋势。

### 当前进度
- `packetEngine` 新增速率控制与 `AdjustRate`（AIMD），并在 `Send` 时合并用户/自适应速率；提供 `SendRST` 支持 RST|ACK 验证报文。
- `ProbeEvent` 捕获 TCP 序列号/ACK，`Prober` 使用分片状态表管理 inflight 探测，收到 SYN/ACK 后触发 RST 验证并汇总统计。
- `probeStats` 收集开放/超时/ICMP 数据，驱动自适应速率；StopTask/超时会清理状态并产生明确错误。
- 未授予原始套接字权限时自动降级为 `DisabledProber`，前端可得到可读错误提示。

### 待办事项
- 对状态表做分片化实现（当前仍是单锁 map），减少大规模扫描时的竞争。
- 增加 UDP 探测与更多验证策略选择（如可选跳过二次验证）。
- 编写独立基准验证丢包率/速率调节效果，并将动态速率在任务 UI 暴露。

## 阶段 4：指纹识别体系改造（规划中）

### 目标
- 抽象指纹模块，统一管理被动数据、主动采集（HTTP/TLS/Banner）与规则匹配，解除与端口探测的强耦合。
- 设计轻量规则格式（参考 nmap service detection，但只保留快速匹配字段），支持多来源特征融合。
- 提供可扩展的探测流水线：端口 → 轻量握手 → Banner → 深度探测（按需执行），并具备“特征去爪”能力（自定义 UA/TLS）。

### 设计要点（草案）
- **Fingerprint Module**：暴露接口 `Collect(ctx, target, port, hints)` 返回 `FingerprintResult`，内部可并行发 HTTP/TLS/Banner 请求；可读取配置决定哪些探测启用。
- **RuleSet**：采用 JSON/YAML 定义 `match` 条件（端口、协议、banner 正则、TLS 证书字段、HTTP header 关键字等），`evidence`/`confidence` 字段表示置信度；支持来源权重。
- **被动数据融合**：从 FOFA/被动资产获取的 `service`/`banner` 作为另一个输入源，写入 `FingerprintResult.Source`；可设置优先级（被动→主动）。
- **反侦测策略**：提供配置模板（UA/TLS 指纹），默认采用“平常浏览器”特征；必要时允许自定义探测模板。

### 实施步骤
1. 新建 `backend/fingerprint` 包：包含 `Collector`、`RuleMatcher`、`RuleStore`、`Result` 数据结构，并提供最小规则集示例。
2. 将 `Manager.enrichFingerprints` 改为调用新模块（传入现有 HTTP 客户端/配置），移除散落的 `probeService` 逻辑。
3. 在 `Collector` 内实现默认的 HTTP/TLS/Banner 探测，与规则匹配模块组合生成最终结果；预留 FOFA 数据对接口。
4. 更新前端展示结构（新增来源、置信度、匹配规则 ID 等字段），并在文档中说明如何扩展规则。

### 当前进度
- 指纹模块已落地：`backend/fingerprint` 提供 Collector、RuleSet、Engine，默认内置 Apache/nginx/TLS 简易规则并采用类浏览器 UA/TLS 指纹。
- `Manager.enrichFingerprints` 调用新引擎，统一填充服务、标题、指纹与规则 ID；旧的 `probeService`/`readBanner` 逻辑已移除。
- 识别结果将 passive/active 证据合并，并对权限不足或采集失败场景返回可读错误而不影响任务流程。
- 文档保留 FOFA/自定义规则扩展接口，为后续融合被动数据打基础。
- 新增 `scripts/fingerprinthub_sync.go`，可自动拉取 FingerprintHub 仓库、转换 JSON 规则并生成 `backend/fingerprint/rules/fingerprinthub_web.json` 与元信息；默认构建流程通过 `go:embed` 加载转换结果，若解析失败回落到简易内建规则。
- HTTPCollector 支持多路径采集与 favicon 抓取，默认先探测根路径；仅在端口或猜测服务呈现 HTTP 特征时才追加 `/index.html`、`/login` 等高价值路径并尝试获取 favicon，从而兼顾准确率与性能。匹配器可利用正文、任意头字段与 favicon hash，并有单测覆盖多响应与 favicon 场景。
- 前端联动实时指标：Manager 按阶段上报任务指标（发送/回包总数、超时/错误、当前速率、阶段耗时），前端以独立卡片展示 PPS、速率、阶段耗时等信息，便于定位“发包慢/卡在验证”等症状。
- 端口扫描调度改为“混合引擎”：默认跨平台 Connect 扫描（零依赖，非阻塞 socket + 令牌桶），在 Linux 自动尝试 SYN 引擎（若缺权限则回退）。Mode 支持 Auto/Connect/SYN，前端提供切换项。
- Windows 下提供 WinDivert 插件：前端 Mode=Auto/SYN 时尝试加载 WinDivert.dll + WinDivert64.sys，成功后启用原始 SYN 扫描；失败（缺管理员、驱动缺失、架构不匹配）自动回落 Connect 模式并保持指标采集。
- 通过 `scripts/fetch_windivert.ps1` 一键下载官方 WinDivert 包，并将 `WinDivert.dll/WinDivert64.sys` 复制到 `resources/windivert/`，运行时若目录里找到这两份文件会自动复制到执行目录；否则回落 Connect 并提示补齐依赖。
