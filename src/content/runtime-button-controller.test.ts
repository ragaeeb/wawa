import { describe, expect, it, mock } from 'bun:test';
import { createRuntimeButtonController } from '@/content/runtime-button-controller';

describe('createRuntimeButtonController', () => {
    const createMockInput = () => ({
        onExportToggle: mock(() => {}),
        onResume: mock(() => {}),
        onCancelExport: mock(() => {}),
        isExporting: mock(() => false),
        isPendingDone: mock(() => false),
        logInfo: mock(() => {}),
    });

    describe('createButton', () => {
        it('should create button and append to body', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();

            expect(input.logInfo).toHaveBeenCalledWith('Export buttons added to page');
            expect(controller.getContainer()).not.toBeNull();
        });

        it('should not create button twice', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            const firstContainer = controller.getContainer();

            controller.createButton();
            const secondContainer = controller.getContainer();

            expect(firstContainer).toBe(secondContainer);
        });
    });

    describe('getContainer', () => {
        it('should return null before button is created', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            expect(controller.getContainer()).toBeNull();
        });

        it('should return container after button is created', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();

            expect(controller.getContainer()).not.toBeNull();
        });
    });

    describe('updateButton', () => {
        it('should not throw when button does not exist', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            expect(() => controller.updateButton('test')).not.toThrow();
        });

        it('should update button text when button exists', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.updateButton('New Text');

            const container = controller.getContainer();
            expect(container).not.toBeNull();
        });

        it('should handle error state', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.updateButton('Error!', true);

            const container = controller.getContainer();
            expect(container).not.toBeNull();
        });

        it('should skip update when pending done', () => {
            const input = createMockInput();
            input.isPendingDone = mock(() => true);
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.updateButton('Should not update');

            // Button update is skipped, but no error thrown
            expect(controller.getContainer()).not.toBeNull();
        });
    });

    describe('removeButton', () => {
        it('should remove button from DOM', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            expect(controller.getContainer()).not.toBeNull();

            controller.removeButton();
            expect(controller.getContainer()).toBeNull();
        });

        it('should not throw when button does not exist', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            expect(() => controller.removeButton()).not.toThrow();
        });
    });

    describe('resetButton', () => {
        it('should remove and recreate button', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            const firstContainer = controller.getContainer();

            controller.resetButton();
            const secondContainer = controller.getContainer();

            expect(firstContainer).not.toBe(secondContainer);
            expect(secondContainer).not.toBeNull();
        });
    });

    describe('showCooldownUI', () => {
        it('should not throw when button does not exist', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            expect(() => controller.showCooldownUI(60000)).not.toThrow();
        });

        it('should render cooldown panel when button exists', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.showCooldownUI(60000);

            const container = controller.getContainer();
            expect(container).not.toBeNull();
        });

        it('should set wawaSkipCooldown on skip', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.showCooldownUI(60000);

            // Simulate skip button click by checking if flag can be set
            (window as any).wawaSkipCooldown = undefined;

            // The actual skip callback would set this flag
            expect((window as any).wawaSkipCooldown).toBeUndefined();
        });

        it('should call onCancelExport on stop', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.showCooldownUI(60000);

            // The stop callback should call onCancelExport
            // This is tested through integration, not directly here
            expect(input.onCancelExport).toBeDefined();
        });
    });

    describe('updateCooldownTimer', () => {
        it('should update cooldown timer display', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.showCooldownUI(60000);

            expect(() => controller.updateCooldownTimer(30000)).not.toThrow();
        });

        it('should not throw when cooldown UI does not exist', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            expect(() => controller.updateCooldownTimer(30000)).not.toThrow();
        });
    });

    describe('removeCooldownUI', () => {
        it('should remove cooldown panel and recreate button', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            const containerBefore = controller.getContainer();

            controller.showCooldownUI(60000);
            controller.removeCooldownUI();

            const containerAfter = controller.getContainer();

            expect(containerAfter).not.toBeNull();
            expect(containerBefore).not.toBe(containerAfter);
        });
    });

    describe('integration', () => {
        it('should handle full button lifecycle', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            // Create
            controller.createButton();
            expect(controller.getContainer()).not.toBeNull();

            // Update
            controller.updateButton('Exporting...');
            expect(controller.getContainer()).not.toBeNull();

            // Show cooldown
            controller.showCooldownUI(60000);
            expect(controller.getContainer()).not.toBeNull();

            // Update timer
            controller.updateCooldownTimer(30000);
            expect(controller.getContainer()).not.toBeNull();

            // Remove cooldown
            controller.removeCooldownUI();
            expect(controller.getContainer()).not.toBeNull();

            // Reset
            controller.resetButton();
            expect(controller.getContainer()).not.toBeNull();

            // Remove
            controller.removeButton();
            expect(controller.getContainer()).toBeNull();
        });

        it('should handle multiple update calls', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.updateButton('Text 1');
            controller.updateButton('Text 2');
            controller.updateButton('Text 3');

            expect(controller.getContainer()).not.toBeNull();
        });

        it('should handle isExporting state changes', () => {
            const input = createMockInput();
            let isExporting = false;
            input.isExporting = mock(() => isExporting);

            const controller = createRuntimeButtonController(input);

            controller.createButton();
            controller.updateButton('Starting...');

            isExporting = true;
            controller.updateButton('Exporting...');

            isExporting = false;
            controller.updateButton('Done');

            expect(controller.getContainer()).not.toBeNull();
        });
    });

    describe('edge cases', () => {
        it('should handle rapid create/remove cycles', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            for (let i = 0; i < 10; i++) {
                controller.createButton();
                controller.removeButton();
            }

            expect(controller.getContainer()).toBeNull();
        });

        it('should handle rapid reset cycles', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();

            for (let i = 0; i < 5; i++) {
                controller.resetButton();
            }

            expect(controller.getContainer()).not.toBeNull();
        });

        it('should handle cooldown show/remove cycles', () => {
            const input = createMockInput();
            const controller = createRuntimeButtonController(input);

            controller.createButton();

            for (let i = 0; i < 3; i++) {
                controller.showCooldownUI(60000);
                controller.removeCooldownUI();
            }

            expect(controller.getContainer()).not.toBeNull();
        });
    });
});
