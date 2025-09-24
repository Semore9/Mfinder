// import { useEffect, useRef, useState } from 'react';
// import "allotment/dist/style.css";
// import TextArea from "antd/es/input/TextArea";
// import { Button, Splitter } from "antd";
// import "@/pages/Domain2IP.css"
// import { errorNotification } from "@/component/Notification";
// import { EventsOn } from "../../wailsjs/runtime";
// import { SyncOutlined } from "@ant-design/icons";
// import 'xterm/css/xterm.css';
// import { CssConfig } from "@/pages/Constants";
// import TabsV2 from "@/component/TabsV2";
// import { useSelector } from "react-redux";
// import { RootState } from "@/store/store";
//
// const TabContent = () => {
//     const [output, setOutput] = useState<string>("")
//     const [targets, setTargets] = useState<string>("")
//     const taskID = useRef<number>(0)
//     const [running, setRunning] = useState<boolean>(false)
//     const event = useSelector((state: RootState) => state.app.global.event)
//
//     useEffect(() => {
//         EventsOn(String(event.domain2IPOutput), (result) => {
//             console.log(2, result.taskID)
//             if (result.taskID === taskID.current) {
//                 if (result.error) {
//                     setOutput(pre => pre + result.error + "\n")
//                 } else if (result.message) {
//                     setOutput(pre => pre + result.message + "\n")
//                 } else if (result.data) {//输出整理C段的信息
//                     const temp: string[] = []
//                     for (const dataKey in result.data) {
//                         temp.push(`C段: ${dataKey} 数量: ${result.data[dataKey]}`)
//                     }
//                     setOutput(pre => pre + `${temp.join("\n")}\n`)
//                 } else {//输出过程信息
//                     const ips: string[] = []
//                     result.ips?.forEach((v: any) => {
//                         const temp: string[] = []
//                         temp.push(v.addr)
//                         v.provider && temp.push(v.provider)
//                         v.country && temp.push(v.country)
//                         v.area && temp.push(v.area)
//                         ips.push(temp.join("/"))
//                     })
//                     setOutput(pre => pre + `${result.domain}    IsCDN: ${result.isCDN}    CNAME: ${result.cnames || ""}    IP: ${ips.join(", ")}\n`)
//                 }
//             }
//         })
//         EventsOn(String(event.domain2IPDown), (result) => {
//             console.log(3, result.taskID)
//             if (result.taskID && result.taskID === taskID.current) {
//                 setRunning(false)
//             }
//         })
//     }, []);
//
//     const run = () => {
//         // GetDetail(targets.split("\n")).then(
//         //     r => {
//         //         taskID.current = r
//         //         console.log(1, r)
//         //         setRunning(true)
//         //     }
//         // )
//     }
//
//     const stop = () => {
//         Stop(taskID.current).then(
//             () => {
//                 taskID.current = 0
//                 setRunning(false)
//             }
//         ).catch(
//             e => errorNotification("错误", e)
//         )
//     }
//
//     return (
//         <div style={{
//             display: "flex",
//             flexDirection: "column",
//             height: `calc(100vh - ${CssConfig.title.height} - ${CssConfig.tab.height})`,
//             padding: "5px 0 5px 0",
//         }}>
//             <Splitter>
//                 <Splitter.Panel>
//                     {!running && <Button size={"small"} style={{ width: "100%" }} onClick={run}>查询</Button>}
//                     {running && <Button size={"small"} style={{ width: "100%" }} onClick={stop}
//                         icon={<SyncOutlined spin={running} />}>终止</Button>}
//                     <TextArea
//                         value={targets}
//                         size={"small"}
//                         placeholder={"每行一个\n识别结果仅供参考\n如果有更好的识别方法请欢迎提出\n尽量不使用第三方网站识别cdn"}
//                         style={{ height: "100%" }}
//                         onChange={e => setTargets(e.target.value)}
//                     />
//                 </Splitter.Panel>
//                 <Splitter.Panel>
//                     <TextArea
//                         wrap={"off"}
//                         value={output}
//                         size={"small"}
//                         style={{ height: "100%" }}
//                         onChange={e => setOutput(e.target.value)}
//                     />
//                 </Splitter.Panel>
//             </Splitter>
//         </div>
//     );
// }
//
// const Domain2IP = () => {
//     return <TabsV2 defaultTabContent={<TabContent />} />
// }
//
// export default Domain2IP;
export {};
