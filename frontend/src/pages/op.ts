export function genshinLaunch() {
    const existingOverlay = document.getElementById("loveOverlay");
    if (existingOverlay) {
        return;
    }

    const styleId = "loveOverlayStyle";
    let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = styleId;
        styleElement.innerHTML = `
            #loveOverlay {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: rgba(0, 0, 0, 0.6);
                color: #fff;
                font-size: clamp(32px, 8vw, 72px);
                font-weight: 600;
                letter-spacing: 0.08em;
                z-index: 1000000000;
                animation: loveOverlayFade 3s ease-in-out forwards;
            }
            #loveOverlay span {
                padding: 0 0.5em;
            }
            @keyframes loveOverlayFade {
                0% {
                    opacity: 0;
                    transform: scale(0.95);
                }
                15% {
                    opacity: 1;
                    transform: scale(1);
                }
                85% {
                    opacity: 1;
                    transform: scale(1);
                }
                100% {
                    opacity: 0;
                    transform: scale(0.97);
                }
            }
        `;
        document.head.appendChild(styleElement);
    }

    const overlay = document.createElement("div");
    overlay.id = "loveOverlay";

    const text = document.createElement("span");
    text.textContent = "I love u";
    overlay.appendChild(text);

    document.body.appendChild(overlay);

    setTimeout(() => {
        overlay.remove();
    }, 3000);
}
