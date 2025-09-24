import React, {CSSProperties, ReactNode} from "react";
import {Flex} from "antd";

interface IcpHeaderProps {
    candidate: ReactNode;
    actions?: ReactNode;
    description?: ReactNode;
    align?: "center" | "left";
    style?: CSSProperties;
}

export const IcpHeader: React.FC<IcpHeaderProps> = ({candidate, actions, description, align = "center", style}) => {
    const justify = actions ? "space-between" : align === "center" ? "center" : "flex-start";
    const textAlign = align === "center" ? "center" : "left";
    return (
        <Flex
            vertical
            gap={6}
            style={{
                padding: "12px 16px",
                backgroundColor: "#f8fafc",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                ...style
            }}
        >
            <Flex gap={12} align={"center"} justify={justify} wrap>
                <Flex
                    style={{flex: actions ? "1 1 auto" : "0 1 auto", justifyContent: align === "center" && !actions ? "center" : "flex-start"}}
                    justify={align === "center" && !actions ? "center" : "flex-start"}
                >
                    {candidate}
                </Flex>
                {actions && (
                    <Flex gap={8} wrap justify={"flex-end"}>
                        {actions}
                    </Flex>
                )}
            </Flex>
            {description && (
                <div style={{fontSize: 12, color: "#64748b", textAlign}}>{description}</div>
            )}
        </Flex>
    );
};

interface IcpFooterBarProps {
    pagination?: ReactNode;
    actions?: ReactNode;
}

export const IcpFooterBar: React.FC<IcpFooterBarProps> = ({pagination, actions}) => {
    if (!pagination && !actions) {
        return null;
    }
    return (
        <Flex
            justify={actions ? "space-between" : "center"}
            align={"center"}
            style={{
                padding: "6px 12px",
                backgroundColor: "#f8fafc",
                borderRadius: 8,
                border: "1px solid #e2e8f0"
            }}
            gap={12}
        >
            {pagination}
            {actions && <Flex gap={8}>{actions}</Flex>}
        </Flex>
    );
};

