type CreateXGrokButtonControllerInput = {
    onExport: () => void;
    logInfo: (message: string, data?: unknown) => void;
};

type XGrokButtonState = {
    text?: string;
    disabled?: boolean;
    isError?: boolean;
};

export type XGrokButtonController = {
    createButton: () => void;
    updateButton: (state: XGrokButtonState) => void;
    resetButton: () => void;
    removeButton: () => void;
};

const BUTTON_CONTAINER_ID = 'wawa-x-grok-button';
const BUTTON_ID = 'wawa-x-grok-export-btn';

const applyContainerStyle = (container: HTMLDivElement, isError: boolean) => {
    container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        background: ${isError ? 'linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)' : 'linear-gradient(135deg, #134e4a 0%, #115e59 100%)'};
        border-radius: 12px;
        padding: 10px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    `;
};

const applyButtonStyle = (button: HTMLButtonElement, disabled: boolean) => {
    button.style.cssText = `
        padding: 10px 16px;
        border: none;
        background: linear-gradient(135deg, #14b8a6 0%, #0f766e 100%);
        color: white;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: ${disabled ? 'default' : 'pointer'};
        opacity: ${disabled ? '0.7' : '1'};
        transition: opacity 0.2s ease;
        text-align: center;
        min-width: 170px;
    `;
};

export const createXGrokButtonController = (input: CreateXGrokButtonControllerInput): XGrokButtonController => {
    let container: HTMLDivElement | null = null;
    let button: HTMLButtonElement | null = null;

    const createButton = () => {
        if (container || !document.body) {
            return;
        }

        container = document.createElement('div');
        container.id = BUTTON_CONTAINER_ID;
        applyContainerStyle(container, false);

        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.textContent = '💬 Export Chat';
        applyButtonStyle(button, false);
        button.onclick = () => {
            input.onExport();
        };

        container.appendChild(button);
        document.body.appendChild(container);
        input.logInfo('X-Grok export button added to page');
    };

    const updateButton = ({ text = '💬 Export Chat', disabled = false, isError = false }: XGrokButtonState) => {
        if (!container || !button) {
            return;
        }

        applyContainerStyle(container, isError);
        applyButtonStyle(button, disabled);
        button.disabled = disabled;
        button.textContent = text;
    };

    const resetButton = () => {
        updateButton({ text: '💬 Export Chat', disabled: false, isError: false });
    };

    const removeButton = () => {
        if (!container) {
            return;
        }

        container.remove();
        container = null;
        button = null;
    };

    return {
        createButton,
        updateButton,
        resetButton,
        removeButton,
    };
};
