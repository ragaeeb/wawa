type MainButtonHandlers = {
    onExportToggle: () => void;
    onResume: () => void;
};

type ButtonStateInput = {
    container: HTMLDivElement;
    text: string;
    isError: boolean;
    isExporting: boolean;
    skipUpdate: boolean;
};

type CooldownPanelInput = {
    container: HTMLDivElement;
    duration: number;
    onSkip: () => void;
    onStop: () => void;
};

type LooksDonePanelInput = {
    container: HTMLDivElement;
    batchCount: number;
    onDownload: () => void;
    onContinue: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
};

type RouteChangePanelInput = {
    container: HTMLDivElement;
    batchCount: number;
    onGoBack: () => void;
    onSaveProgress: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
};

type RateLimitPanelInput = {
    container: HTMLDivElement;
    retryCount: number;
    remaining: number;
    limit: number;
    batchesCollected: number;
    resetTimeLabel: string;
    onTryNow: () => void;
    onSaveProgress: () => void;
    onResumeLink: () => void;
    onCancel: () => void;
};

const createButtonStyle = (background: string, color: string) => {
    return `
            padding: 8px 12px;
            border: none;
            background: ${background};
            color: ${color};
            cursor: pointer;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            transition: opacity 0.2s;
        `;
};

const createActionButton = (label: string, style: string, onClick: (event: MouseEvent) => void) => {
    const button = document.createElement('button');
    button.textContent = label;
    button.style.cssText = style;
    button.onclick = onClick;
    return button;
};

const setContainerStyle = (container: HTMLDivElement, cssText: string) => {
    container.style.cssText = cssText;
};

export const hasBlockingOverlayControls = () => {
    return Boolean(
        document.getElementById('wawa-rl-controls') ||
            document.getElementById('wawa-done-controls') ||
            document.getElementById('wawa-route-controls'),
    );
};

export const createMainButtonContainer = ({ onExportToggle, onResume }: MainButtonHandlers) => {
    const container = document.createElement('div');
    container.id = 'wawa-button';
    setContainerStyle(
        container,
        `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border-radius: 12px;
            padding: 10px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            display: flex;
            flex-direction: column;
            gap: 6px;
            min-width: 160px;
        `,
    );

    const baseMainButtonStyle = (background: string) => `
            padding: 10px 16px;
            border: none;
            background: ${background};
            color: white;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
        `;

    const exportButton = document.createElement('button');
    exportButton.id = 'wawa-export-btn';
    exportButton.textContent = '📜 Export Tweets';
    exportButton.style.cssText = baseMainButtonStyle('linear-gradient(135deg, #1d9bf0 0%, #1a8cd8 100%)');
    exportButton.onclick = onExportToggle;

    const resumeButton = document.createElement('button');
    resumeButton.id = 'wawa-resume-btn';
    resumeButton.textContent = '📂 Resume';
    resumeButton.style.cssText = baseMainButtonStyle('linear-gradient(135deg, #9C27B0 0%, #7B1FA2 100%)');
    resumeButton.onclick = onResume;

    container.appendChild(exportButton);
    container.appendChild(resumeButton);

    return container;
};

export const updateMainButtonState = ({ container, text, isError, isExporting, skipUpdate }: ButtonStateInput) => {
    if (skipUpdate) {
        return;
    }

    const exportButton = document.getElementById('wawa-export-btn');
    if (exportButton) {
        exportButton.textContent = text;
    } else {
        container.textContent = text;
    }

    if (isError) {
        container.style.background = 'linear-gradient(135deg, #f4212e 0%, #d91c27 100%)';
        container.style.boxShadow = '0 4px 12px rgba(244, 33, 46, 0.4)';
        return;
    }

    if (isExporting) {
        container.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
        return;
    }

    container.style.background = 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)';
};

const formatDuration = (milliseconds: number) => {
    const totalSeconds = Math.ceil(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const renderCooldownPanel = ({ container, duration, onSkip, onStop }: CooldownPanelInput) => {
    container.innerHTML = '';
    setContainerStyle(
        container,
        `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #FF9800 0%, #E65100 100%);
            border: 1px solid #FFC107;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(255, 152, 0, 0.4);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
            color: white;
        `,
    );

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 14px;';
    header.innerHTML = '<span style="font-size: 18px;">⏳</span> Rate Limit Cooldown';
    container.appendChild(header);

    const timerDisplay = document.createElement('div');
    timerDisplay.id = 'wawa-cooldown-timer';
    timerDisplay.style.cssText = 'font-size: 24px; font-weight: bold; text-align: center; margin: 4px 0;';
    timerDisplay.textContent = formatDuration(duration);
    container.appendChild(timerDisplay);

    const controls = document.createElement('div');
    controls.id = 'wawa-rl-controls';
    controls.style.cssText = 'display: flex; gap: 8px;';

    const skipButton = document.createElement('button');
    skipButton.textContent = '⚡ Skip Wait';
    skipButton.style.cssText = `
            flex: 1;
            padding: 8px;
            border: none;
            background: rgba(255, 255, 255, 0.2);
            color: white;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.2s;
        `;
    skipButton.onmouseover = () => {
        skipButton.style.background = 'rgba(255, 255, 255, 0.3)';
    };
    skipButton.onmouseout = () => {
        skipButton.style.background = 'rgba(255, 255, 255, 0.2)';
    };
    skipButton.onclick = onSkip;

    const stopButton = document.createElement('button');
    stopButton.textContent = '🛑 Stop';
    stopButton.style.cssText = `
            flex: 0 0 60px;
            padding: 8px;
            border: none;
            background: rgba(0, 0, 0, 0.2);
            color: white;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
        `;
    stopButton.onclick = () => {
        if (confirm('Stop export and save current progress?')) {
            onStop();
        }
    };

    controls.appendChild(skipButton);
    controls.appendChild(stopButton);
    container.appendChild(controls);
};

export const updateCooldownTimerDisplay = (milliseconds: number) => {
    const timer = document.getElementById('wawa-cooldown-timer');
    if (timer) {
        timer.textContent = formatDuration(milliseconds);
    }
};

export const renderLooksDonePanel = ({
    container,
    batchCount,
    onDownload,
    onContinue,
    onResumeLink,
    onCancel,
}: LooksDonePanelInput) => {
    container.innerHTML = '';
    setContainerStyle(
        container,
        `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #4CAF50;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(76, 175, 80, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `,
    );

    const header = document.createElement('div');
    header.style.cssText =
        'display: flex; align-items: center; gap: 8px; color: #4CAF50; font-weight: bold; font-size: 14px;';
    header.innerHTML = '<span style="font-size: 18px;">✅</span> Looks Complete!';
    container.appendChild(header);

    const info = document.createElement('div');
    info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
    info.innerHTML = `
            <div>${batchCount} batches collected</div>
            <div style="margin-top: 4px;">Timeline appears to have ended. What would you like to do?</div>
        `;
    container.appendChild(info);

    const controls = document.createElement('div');
    controls.id = 'wawa-done-controls';
    controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    controls.appendChild(
        createActionButton('💾 Download Now', createButtonStyle('#4CAF50', '#fff'), (event) => {
            event.stopPropagation();
            onDownload();
        }),
    );
    controls.appendChild(
        createActionButton('📜 Keep Scrolling', createButtonStyle('#2196F3', '#fff'), (event) => {
            event.stopPropagation();
            onContinue();
        }),
    );
    controls.appendChild(
        createActionButton('🔗 Copy Resume Link', createButtonStyle('#9C27B0', '#fff'), (event) => {
            event.stopPropagation();
            onResumeLink();
        }),
    );
    controls.appendChild(
        createActionButton(
            '✖️ Cancel Export',
            `${createButtonStyle('transparent', '#888')}border: 1px solid #444;`,
            (event) => {
                event.stopPropagation();
                onCancel();
            },
        ),
    );

    container.appendChild(controls);
};

export const renderRouteChangePanel = ({
    container,
    batchCount,
    onGoBack,
    onSaveProgress,
    onResumeLink,
    onCancel,
}: RouteChangePanelInput) => {
    container.innerHTML = '';
    setContainerStyle(
        container,
        `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #FF9800;
            border-radius: 12px;
            padding: 14px;
            min-width: 240px;
            box-shadow: 0 8px 24px rgba(255, 152, 0, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `,
    );

    const header = document.createElement('div');
    header.style.cssText =
        'display: flex; align-items: center; gap: 8px; color: #FF9800; font-weight: bold; font-size: 14px;';
    header.innerHTML = '<span style="font-size: 18px;">⚠️</span> Navigation Detected!';
    container.appendChild(header);

    const info = document.createElement('div');
    info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
    info.innerHTML = `
            <div>You navigated away from the search page.</div>
            <div style="margin-top: 4px;">${batchCount} batches collected so far.</div>
            <div style="margin-top: 4px; color: #FF9800;">Go back to continue, or save your progress.</div>
        `;
    container.appendChild(info);

    const controls = document.createElement('div');
    controls.id = 'wawa-route-controls';
    controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    controls.appendChild(
        createActionButton('⬅️ Go Back & Continue', createButtonStyle('#4CAF50', '#fff'), (event) => {
            event.stopPropagation();
            onGoBack();
        }),
    );
    controls.appendChild(
        createActionButton('💾 Save Progress', createButtonStyle('#2196F3', '#fff'), (event) => {
            event.stopPropagation();
            onSaveProgress();
        }),
    );
    controls.appendChild(
        createActionButton('🔗 Copy Resume Link', createButtonStyle('#9C27B0', '#fff'), (event) => {
            event.stopPropagation();
            onResumeLink();
        }),
    );
    controls.appendChild(
        createActionButton(
            '✖️ Cancel Export',
            `${createButtonStyle('transparent', '#888')}border: 1px solid #444;`,
            (event) => {
                event.stopPropagation();
                onCancel();
            },
        ),
    );

    container.appendChild(controls);
};

export const renderRateLimitPanel = ({
    container,
    retryCount,
    remaining,
    limit,
    batchesCollected,
    resetTimeLabel,
    onTryNow,
    onSaveProgress,
    onResumeLink,
    onCancel,
}: RateLimitPanelInput) => {
    container.innerHTML = '';
    setContainerStyle(
        container,
        `
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            border: 1px solid #e94560;
            border-radius: 12px;
            padding: 14px;
            min-width: 220px;
            box-shadow: 0 8px 24px rgba(233, 69, 96, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `,
    );

    const header = document.createElement('div');
    header.style.cssText =
        'display: flex; align-items: center; gap: 8px; color: #e94560; font-weight: bold; font-size: 14px;';
    header.innerHTML = `<span style="font-size: 18px;">🔴</span> Rate Limit Hit (Retry #${retryCount})`;
    container.appendChild(header);

    const waitMinutes = retryCount * 10;
    const info = document.createElement('div');
    info.style.cssText = 'color: #a0a0a0; font-size: 11px; line-height: 1.4;';
    info.innerHTML = `
            <div>${batchesCollected} batches collected (${remaining}/${limit} API calls left)</div>
            <div style="margin-top: 4px;">Suggested wait: <strong>${waitMinutes} min</strong> | Reset: ${resetTimeLabel}</div>
        `;
    container.appendChild(info);

    const controls = document.createElement('div');
    controls.id = 'wawa-rl-controls';
    controls.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

    controls.appendChild(
        createActionButton('▶️ Try Now', createButtonStyle('#4CAF50', '#fff'), (event) => {
            event.stopPropagation();
            onTryNow();
        }),
    );
    controls.appendChild(
        createActionButton('💾 Save Progress', createButtonStyle('#2196F3', '#fff'), (event) => {
            event.stopPropagation();
            onSaveProgress();
        }),
    );
    controls.appendChild(
        createActionButton('🔗 Copy Resume Link', createButtonStyle('#9C27B0', '#fff'), (event) => {
            event.stopPropagation();
            onResumeLink();
        }),
    );
    controls.appendChild(
        createActionButton(
            '✖️ Cancel Export',
            `${createButtonStyle('transparent', '#888')}border: 1px solid #444;`,
            (event) => {
                event.stopPropagation();
                onCancel();
            },
        ),
    );

    container.appendChild(controls);
};
