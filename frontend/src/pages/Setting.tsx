import React, { useEffect, useMemo, useState } from "react";
import type { ButtonProps } from "antd";
import {
  Button,
  Collapse,
  Flex,
  Input,
  Select,
  Space,
  Switch,
  message,
} from "antd";
import { LinkOutlined } from "@ant-design/icons";
import "./Setting.css";
import { useDispatch, useSelector } from "react-redux";
import { appActions, RootState } from "@/store/store";
import { errorNotification } from "@/component/Notification";
import DirectorySelector from "@/component/DirectorySelector";
import FileSelector from "@/component/FileSelector";
import { SetAuth as SetHunterAuth } from "../../wailsjs/go/hunter/Bridge";
import { SetAuth as SetFofaAuth } from "../../wailsjs/go/fofa/Bridge";
import { SetAuth as SetQuakeAuth } from "../../wailsjs/go/quake/Bridge";
import { SetAuth as SetTianYanChaAuth } from "../../wailsjs/go/tianyancha/Bridge";
import { SetAuth as SetAiQiChaAuth } from "../../wailsjs/go/aiqicha/Bridge";
import { SetAuth as SetShodanAuth } from "../../wailsjs/go/shodan/Bridge";
import { SetAppletPath } from "../../wailsjs/go/wechat/Bridge";
import { config } from "../../wailsjs/go/models";
import { BrowserOpenURL } from "../../wailsjs/runtime";
import {
  DetectWeChatAppletPath,
  SaveDatabaseFile,
  SaveExportDataDir,
  SaveLogDataDir,
  SaveProxy,
  SaveQueryOnEnter,
  SaveTimeout,
  SaveWechatDataDir,
} from "../../wailsjs/go/application/Application";
import {
  SaveICPConfig,
  SetProxy,
  SetProxyTimeout,
} from "../../wailsjs/go/icp/Bridge";
import Number from "@/component/Number";
import Password from "@/component/Password";

export const buttonProps: ButtonProps = {
  type: "default",
  shape: "round",
  size: "small",
};

interface ServiceLinkProps {
  name: string;
  url: string;
}

const ServiceLink: React.FC<ServiceLinkProps> = ({ name, url }) => {
  const handleClick = () => {
    if (url) {
      BrowserOpenURL(url);
    }
  };
  return (
    <Flex
      align="center"
      gap={6}
      style={{ cursor: "pointer", color: "#1677ff" }}
      onClick={handleClick}
    >
      <LinkOutlined style={{ fontSize: 14 }} />
      <span>{name}</span>
    </Flex>
  );
};

export interface ProxyPros {
  labelWidth?: number;
  title?: string;
  proxy: config.Proxy;
  update: (proxy: config.Proxy) => void;
}

export const Proxy: React.FC<ProxyPros> = (props) => {
  const [editable, setEditable] = useState(false);
  const [proxyConf, setProxyConf] = useState<config.Proxy>(props.proxy);

  useEffect(() => {
    setProxyConf(props.proxy);
  }, [props.proxy]);

  const cancel = () => {
    setProxyConf(props.proxy);
    setEditable(false);
  };

  const save = (enable: boolean) => {
    setEditable(false);
    const t = { ...proxyConf, Enable: enable } as config.Proxy;
    props.update(t);
  };

  return (
    <Flex justify={"left"}>
      <span
        style={{
          width: props.labelWidth || "fit-content",
          marginRight: "5px",
          display: "inline-block",
        }}
      >
        {props.title || "代理"}
      </span>
      <span style={{ marginRight: "10px" }}>
        <Space.Compact size={"small"} style={{ width: "100%" }}>
          <Select
            defaultValue={proxyConf.Type}
            value={proxyConf.Type}
            style={{ width: "90px" }}
            options={[
              { label: "http", value: "http" },
              { label: "socks5", value: "socks5" },
            ]}
            disabled={!editable}
            onChange={(v) => {
              if (editable)
                setProxyConf((preState) => {
                  return { ...preState, Type: v };
                });
            }}
          />
          <Input
            value={proxyConf.Host}
            placeholder={"host"}
            style={{ width: "140px" }}
            disabled={!editable}
            onChange={(e) => {
              if (editable)
                setProxyConf((preState) => {
                  return { ...preState, Host: e.target.value };
                });
            }}
          />
          <Input
            value={proxyConf.Port}
            placeholder={"port"}
            style={{ width: "80px" }}
            disabled={!editable}
            onChange={(e) => {
              if (editable)
                setProxyConf((preState) => {
                  return { ...preState, Port: e.target.value };
                });
            }}
          />
          <Input
            value={proxyConf.User}
            placeholder={"user"}
            style={{ width: "100px" }}
            disabled={!editable}
            onChange={(e) => {
              if (editable)
                setProxyConf((preState) => {
                  return { ...preState, User: e.target.value };
                });
            }}
          />
          <Input.Password
            value={proxyConf.Pass}
            placeholder={"pass"}
            style={{ width: "100px" }}
            disabled={!editable}
            onChange={(e) => {
              if (editable)
                setProxyConf((preState) => {
                  return { ...preState, Pass: e.target.value };
                });
            }}
          />
        </Space.Compact>
      </span>
      <Flex gap={10} align={"center"}>
        {!editable ? (
          <Button
            {...buttonProps}
            disabled={false}
            onClick={() => setEditable(true)}
          >
            修改
          </Button>
        ) : (
          <Flex gap={10}>
            <Button {...buttonProps} onClick={() => save(proxyConf.Enable)}>
              保存
            </Button>
            <Button {...buttonProps} onClick={cancel}>
              取消
            </Button>
          </Flex>
        )}
        <Switch
          value={proxyConf.Enable}
          size="default"
          checkedChildren="开启"
          unCheckedChildren="关闭"
          style={{ width: "max-content" }}
          onChange={(v) => {
            if (!editable) save(v);
          }}
        />
      </Flex>
    </Flex>
  );
};

export const Other = () => {
  const dispatch = useDispatch();
  const cfg = useSelector(
    (state: RootState) => state.app.global.config || new config.Config(),
  );

  const saveAssets = (enable: boolean) => {
    const t = { ...cfg.QueryOnEnter };
    t.Assets = enable;
    SaveQueryOnEnter(t)
      .then(() => {
        const tt = { ...cfg, QueryOnEnter: t } as config.Config;
        dispatch(appActions.setConfig(tt));
      })
      .catch((err) => {
        errorNotification("错误", err, 3);
      });
  };

  const saveIcp = (enable: boolean) => {
    const t = { ...cfg.QueryOnEnter };
    t.ICP = enable;
    SaveQueryOnEnter(t)
      .then(() => {
        const tt = { ...cfg } as config.Config;
        tt.QueryOnEnter = t;
        dispatch(appActions.setConfig(tt));
      })
      .catch((err) => errorNotification("错误", err, 3));
  };

  const saveIP138 = (enable: boolean) => {
    const t = { ...cfg.QueryOnEnter };
    t.IP138 = enable;
    SaveQueryOnEnter(t)
      .then(() => {
        const tt = { ...cfg } as config.Config;
        tt.QueryOnEnter = t;
        dispatch(appActions.setConfig(tt));
      })
      .catch((err) => errorNotification("错误", err, 3));
  };

  return (
    <Flex gap={40}>
      <span>
        <span
          style={{
            display: "inline-block",
            textAlign: "left",
            paddingRight: "5px",
            height: "24px",
          }}
        >
          IP138 Enter键执行搜索
        </span>
        <span>
          <Switch
            size={"small"}
            value={cfg.QueryOnEnter.IP138}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(v) => saveIP138(v)}
          />
        </span>
      </span>
      <span>
        <span
          style={{
            display: "inline-block",
            textAlign: "left",
            paddingRight: "5px",
            height: "24px",
          }}
        >
          ICP Enter键执行搜索
        </span>
        <span>
          <Switch
            size={"small"}
            value={cfg.QueryOnEnter.ICP}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(v) => saveIcp(v)}
          />
        </span>
      </span>
      <span>
        <span
          style={{
            display: "inline-block",
            textAlign: "left",
            paddingRight: "5px",
            height: "24px",
          }}
        >
          网络资产测绘Enter键执行搜索
        </span>
        <span>
          <Switch
            size={"small"}
            value={cfg.QueryOnEnter.Assets}
            checkedChildren="开启"
            unCheckedChildren="关闭"
            onChange={(v) => saveAssets(v)}
          />
        </span>
      </span>
    </Flex>
  );
};

interface FileSelectorProps {
  label?: string;
  labelWidth?: string | number;
  value?: string;
  width?: string | number;
  onSelect?: (path: string) => void;
}

export const Setting: React.FC = () => {
  const dispatch = useDispatch();
  const cfg = useSelector((state: RootState) => state.app.global.config);
  const proxy = useSelector(
    (state: RootState) => state.app.global.config.Proxy,
  );
  const [detectingApplet, setDetectingApplet] = useState(false);

  const updateProxy = (p: config.Proxy) => {
    SaveProxy(p)
      .then(() => {
        const tt = { ...cfg, Proxy: p } as config.Config;
        dispatch(appActions.setConfig(tt));
      })
      .catch((err) => {
        errorNotification("错误", err, 3);
      });
  };

  const ICPForm: React.FC = () => {
    const updateProxy = (p: config.Proxy) => {
      SetProxy(p)
        .then(() => {
          const tt = { ...cfg, ICP: { ...cfg.ICP, Proxy: p } } as config.Config;
          dispatch(appActions.setConfig(tt));
        })
        .catch((err) => {
          errorNotification("错误", err, 3);
        });
    };
    const update = async (icp: config.ICP) => {
      try {
        await SaveICPConfig(icp);
        const tt = { ...cfg, ICP: icp } as config.Config;
        dispatch(appActions.setConfig(tt));
        return true;
      } catch (e) {
        errorNotification("错误", e);
        return false;
      }
    };
    return (
      <Flex justify={"left"} vertical gap={10}>
        <Proxy labelWidth={40} proxy={cfg.ICP.Proxy} update={updateProxy} />
        <Number
          labelWidth={200}
          label={"单查询时认证错误重试次数"}
          value={cfg.ICP.AuthErrorRetryNum1}
          onChange={(value) =>
            update({
              ...cfg.ICP,
              AuthErrorRetryNum1: value as number,
            } as config.ICP)
          }
        />
        <Number
          labelWidth={200}
          label={"单查询时403错误误重试次数"}
          value={cfg.ICP.ForbiddenErrorRetryNum1}
          onChange={(value) =>
            update({
              ...cfg.ICP,
              ForbiddenErrorRetryNum1: value as number,
            } as config.ICP)
          }
        />
        <Number
          labelWidth={200}
          label={"批量查询时认证错误重试次数"}
          value={cfg.ICP.AuthErrorRetryNum2}
          onChange={(value) =>
            update({
              ...cfg.ICP,
              AuthErrorRetryNum2: value as number,
            } as config.ICP)
          }
        />
        <Number
          labelWidth={200}
          label={"批量查询403错误误重试次数"}
          value={cfg.ICP.ForbiddenErrorRetryNum2}
          onChange={(value) =>
            update({
              ...cfg.ICP,
              ForbiddenErrorRetryNum2: value as number,
            } as config.ICP)
          }
        />
        <Number
          labelWidth={200}
          label={"批量查询协程数"}
          value={cfg.ICP.Concurrency}
          onChange={(value) =>
            update({ ...cfg.ICP, Concurrency: value as number } as config.ICP)
          }
        />
        <Number
          labelWidth={200}
          label={"批量查询代理超时（ns）"}
          width={200}
          value={cfg.ICP.Timeout}
          onChange={async (value) => {
            try {
              await SetProxyTimeout(value);
              const tt = {
                ...cfg,
                ICP: { ...cfg.ICP, Timeout: value },
              } as config.Config;
              dispatch(appActions.setConfig(tt));
              return true;
            } catch (e) {
              errorNotification("错误", e);
              return false;
            }
          }}
        />
      </Flex>
    );
  };

  const updateDatabaseFile = (file?: string) => {
    if (!file) {
      return;
    }
    SaveDatabaseFile(file)
      .then(() => {
        const tt = { ...cfg, DatabaseFile: file } as config.Config;
        dispatch(appActions.setConfig(tt));
        message.success("数据库文件已更新");
      })
      .catch((err) => errorNotification("错误", err));
  };

  const updateWechatDataDir = (dir?: string) => {
    if (!dir) {
      return;
    }
    SaveWechatDataDir(dir)
      .then(() => {
        const tt = { ...cfg, WechatDataDir: dir } as config.Config;
        dispatch(appActions.setConfig(tt));
        message.success("微信结果目录已更新");
      })
      .catch((err) => errorNotification("错误", err));
  };

  const updateExportDataDir = (dir?: string) => {
    if (!dir) {
      return;
    }
    SaveExportDataDir(dir)
      .then(() => {
        const tt = { ...cfg, ExportDataDir: dir } as config.Config;
        dispatch(appActions.setConfig(tt));
        message.success("导出目录已更新");
      })
      .catch((err) => errorNotification("错误", err));
  };

  const updateLogDataDir = (dir?: string) => {
    if (!dir) {
      return;
    }
    SaveLogDataDir(dir)
      .then(() => {
        const tt = { ...cfg, LogDataDir: dir } as config.Config;
        dispatch(appActions.setConfig(tt));
        message.success("日志目录已更新");
      })
      .catch((err) => errorNotification("错误", err));
  };

  const updateWechatAppletPath = (dir?: string, showToast: boolean = true) => {
    if (!dir) {
      return;
    }
    SetAppletPath(dir)
      .then(() => {
        const tt = {
          ...cfg,
          Wechat: { ...cfg.Wechat, Applet: dir },
        } as config.Config;
        dispatch(appActions.setConfig(tt));
        if (showToast) {
          message.success("小程序目录已更新");
        }
      })
      .catch((err) => errorNotification("错误", err));
  };

  const detectWechatAppletPath = async () => {
    setDetectingApplet(true);
    try {
      const detected = await DetectWeChatAppletPath();
      if (!detected) {
        message.warning("未检测到可用的微信小程序目录");
        return;
      }
      updateWechatAppletPath(detected, false);
      message.success(`检测到微信小程序目录: ${detected}`);
    } catch (err) {
      errorNotification("错误", err, 3);
    } finally {
      setDetectingApplet(false);
    }
  };
  const collapseItems = useMemo(
    () => [
      {
        key: "global",
        label: "全局设置",
        children: (
          <Flex vertical gap={10}>
            <Number
              labelWidth={80}
              width={200}
              label={"超时（ns）"}
              value={cfg.Timeout}
              onChange={async (value) => {
                try {
                  await SaveTimeout(value);
                  return true;
                } catch (e) {
                  errorNotification("错误", e);
                  return false;
                }
              }}
            />
            <FileSelector
              label={"数据库文件"}
              labelWidth={100}
              value={cfg.DatabaseFile}
              inputWidth={400}
              onSelect={updateDatabaseFile}
            />
            <DirectorySelector
              label={"导出数据目录"}
              labelWidth={100}
              value={cfg.ExportDataDir}
              inputWidth={400}
              onSelect={updateExportDataDir}
            />
            <DirectorySelector
              label={"日志目录"}
              labelWidth={100}
              value={cfg.LogDataDir}
              inputWidth={400}
              onSelect={updateLogDataDir}
            />
            <Proxy labelWidth={100} proxy={proxy} update={updateProxy} />
          </Flex>
        ),
      },
      {
        key: "wechat",
        label: "微信设置",
        children: (
          <Flex vertical gap={10}>
            <DirectorySelector
              label={"微信结果目录"}
              labelWidth={110}
              value={cfg.WechatDataDir}
              inputWidth={400}
              onSelect={updateWechatDataDir}
            />
            <Flex gap={10} align={"center"} wrap="wrap">
              <DirectorySelector
                label={"微信Applet路径"}
                labelWidth={110}
                inputWidth={400}
                value={cfg.Wechat?.Applet}
                onSelect={(dir) => updateWechatAppletPath(dir)}
                placeholder="请选择或自动检测"
              />
              <Button
                {...buttonProps}
                type="primary"
                loading={detectingApplet}
                onClick={detectWechatAppletPath}
              >
                自动检测
              </Button>
            </Flex>
          </Flex>
        ),
      },
      {
        key: "assets",
        label: "测绘服务认证",
        children: (
          <Flex vertical gap={10}>
            <Password
              label={<ServiceLink name={"FOFA"} url={"https://fofa.info"} />}
              labelWidth={120}
              width={400}
              value={cfg.Fofa.Token}
              onSubmit={async (value) => {
                try {
                  await SetFofaAuth(value);
                  const t = {
                    ...cfg,
                    Fofa: { ...cfg.Fofa, Token: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
            <Password
              label={
                <ServiceLink
                  name={"Hunter"}
                  url={"https://hunter.qianxin.com"}
                />
              }
              labelWidth={120}
              width={400}
              value={cfg.Hunter.Token}
              onSubmit={async (value) => {
                try {
                  await SetHunterAuth(value);
                  const t = {
                    ...cfg,
                    Hunter: { ...cfg.Hunter, Token: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
            <Password
              label={
                <ServiceLink name={"Quake"} url={"https://quake.360.net"} />
              }
              labelWidth={120}
              width={400}
              value={cfg.Quake.Token}
              onSubmit={async (value) => {
                try {
                  await SetQuakeAuth(value);
                  const t = {
                    ...cfg,
                    Quake: { ...cfg.Quake, Token: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
            <Password
              label={
                <ServiceLink name={"Shodan"} url={"https://www.shodan.io"} />
              }
              labelWidth={120}
              width={400}
              value={cfg.Shodan.Token}
              onSubmit={async (value) => {
                try {
                  await SetShodanAuth(value);
                  const t = {
                    ...cfg,
                    Shodan: { ...cfg.Shodan, Token: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
          </Flex>
        ),
      },
      {
        key: "business",
        label: "企业信息服务",
        children: (
          <Flex vertical gap={10}>
            <Password
              label={
                <ServiceLink
                  name={"天眼查"}
                  url={"https://www.tianyancha.com"}
                />
              }
              placeholder={"auth_token"}
              labelWidth={120}
              width={400}
              value={cfg.TianYanCha.Token}
              onSubmit={async (value) => {
                try {
                  await SetTianYanChaAuth(value);
                  const t = {
                    ...cfg,
                    TianYanCha: { ...cfg.TianYanCha, Token: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
            <Password
              label={
                <ServiceLink
                  name={"爱企查"}
                  url={"https://aiqicha.baidu.com"}
                />
              }
              placeholder={"cookie"}
              labelWidth={120}
              width={400}
              value={cfg.AiQiCha.Cookie}
              onSubmit={async (value) => {
                try {
                  await SetAiQiChaAuth(value);
                  const t = {
                    ...cfg,
                    AiQiCha: { ...cfg.AiQiCha, Cookie: value },
                  } as config.Config;
                  dispatch(appActions.setConfig(t));
                  return true;
                } catch (e) {
                  errorNotification("错误", e, 3);
                  return false;
                }
              }}
            />
          </Flex>
        ),
      },
      {
        key: "shortcut",
        label: "快捷行为",
        children: <Other />,
      },
      {
        key: "icp",
        label: "ICP 配置",
        children: <ICPForm />,
      },
    ],
    [cfg, proxy, detectingApplet],
  );

  return (
    <Flex
      vertical
      style={{
        height: "100%",
        overflow: "auto",
        padding: "10px",
        boxSizing: "border-box",
      }}
    >
      <Collapse
        bordered={false}
        defaultActiveKey={["global", "wechat"]}
        items={collapseItems}
      />
    </Flex>
  );
};
