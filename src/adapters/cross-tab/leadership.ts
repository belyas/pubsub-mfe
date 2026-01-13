import type { ClientId } from "./types";

/**
 * Leadership status and metadata.
 */
export interface LeadershipState {
  /**
   * Whether this tab is currently the leader.
   */
  isLeader: boolean;

  /**
   * Current client ID of this tab.
   */
  clientId: ClientId;

  /**
   * Timestamp when leadership state was last updated.
   */
  lastUpdate: number;
}

/**
 * Configuration for leadership detection.
 */
export interface LeadershipConfig {
  /**
   * Client ID for this tab.
   */
  clientId: ClientId;

  /**
   * Optional callback when leadership status changes.
   *
   * @param isLeader - New leadership status
   */
  onLeadershipChange?: (isLeader: boolean) => void;

  /**
   * Enable debug logging.
   *
   * @default false
   */
  debug?: boolean;
}

/**
 * Leadership detector based on document visibility.
 *
 * Monitors document.visibilityState and provides leadership status.
 * Does not require coordination with other tabs - each tab independently
 * determines if it should act as leader based on its visibility state.
 *
 * For multi-tab coordination (knowing about other tabs), use in combination
 * with a cross-tab transport layer.
 *
 * @example
 * ```ts
 * const detector = new LeadershipDetector({
 *   clientId: 'tab-123',
 *   onLeadershipChange: (isLeader) => {
 *     if (isLeader) {
 *       console.log('I am now the leader');
 *       startWebSocketConnection();
 *     } else {
 *       console.log('I am no longer the leader');
 *       stopWebSocketConnection();
 *     }
 *   }
 * });
 *
 * // Later, check current status
 * if (detector.isLeader()) {
 *   // Perform leader-only tasks
 * }
 *
 * // Cleanup
 * detector.stop();
 * ```
 */
export class LeadershipDetector {
  private readonly clientId: ClientId;
  private readonly onLeadershipChange?: (isLeader: boolean) => void;
  private readonly debug: boolean;
  private isActive: boolean;
  private currentlyLeader: boolean;
  private visibilityChangeHandler?: () => void;

  constructor(config: LeadershipConfig) {
    this.clientId = config.clientId;
    this.onLeadershipChange = config.onLeadershipChange;
    this.debug = config.debug ?? false;
    this.isActive = false;
    this.currentlyLeader = false;

    this.start();
  }

  /**
   * Start leadership detection.
   *
   * Attaches visibilitychange event listener and performs initial check.
   * Called automatically by constructor.
   */
  start(): void {
    if (this.isActive) {
      return;
    }

    this.isActive = true;

    // Initial check (without triggering callback)
    this.updateLeadershipState(true);

    if (typeof document !== "undefined") {
      this.visibilityChangeHandler = () => this.handleVisibilityChange();
      document.addEventListener("visibilitychange", this.visibilityChangeHandler);

      if (this.debug) {
        console.log("[Leadership] Started", {
          clientId: this.clientId,
          isLeader: this.currentlyLeader,
          visibilityState: document.visibilityState,
        });
      }
    }
  }

  /**
   * Stop leadership detection.
   *
   * Removes event listeners and marks as inactive.
   * Should be called when the detector is no longer needed.
   */
  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    if (typeof document !== "undefined" && this.visibilityChangeHandler) {
      document.removeEventListener("visibilitychange", this.visibilityChangeHandler);
      this.visibilityChangeHandler = undefined;
    }

    if (this.debug) {
      console.log("[Leadership] Stopped", { clientId: this.clientId });
    }
  }

  /**
   * Check if this tab is currently the leader.
   *
   * @returns true if this tab should act as leader
   */
  isLeader(): boolean {
    return this.currentlyLeader;
  }

  /**
   * Get current leadership state.
   *
   * @returns Leadership state object
   */
  getState(): LeadershipState {
    return {
      isLeader: this.currentlyLeader,
      clientId: this.clientId,
      lastUpdate: Date.now(),
    };
  }

  /**
   * Force a leadership state check.
   *
   * Useful for manual state refresh or testing.
   * Returns true if leadership state changed.
   */
  refresh(): boolean {
    return this.updateLeadershipState();
  }

  /**
   * Handle document visibility change event.
   *
   * @private
   */
  private handleVisibilityChange(): void {
    if (this.debug) {
      console.log("[Leadership] Visibility changed", {
        visibilityState: typeof document !== "undefined" ? document.visibilityState : "unknown",
      });
    }

    this.updateLeadershipState();
  }

  /**
   * Update leadership state based on current visibility.
   *
   * Returns true if leadership state changed.
   *
   * @param skipCallback - Skip calling the onChange callback (for initial setup)
   * @private
   */
  private updateLeadershipState(skipCallback = false): boolean {
    const wasLeader = this.currentlyLeader;
    const isVisible = this.isTabVisible();

    // Simple rule: visible tabs are leaders
    // For more sophisticated coordination (e.g. only one leader among multiple visible tabs),
    // this would need to communicate with other tabs via BroadcastChannel
    this.currentlyLeader = isVisible;

    const changed = wasLeader !== this.currentlyLeader;

    if (changed && !skipCallback) {
      if (this.debug) {
        console.log("[Leadership] State changed", {
          clientId: this.clientId,
          wasLeader,
          isLeader: this.currentlyLeader,
          visibilityState: typeof document !== "undefined" ? document.visibilityState : "unknown",
        });
      }

      if (this.onLeadershipChange) {
        try {
          this.onLeadershipChange(this.currentlyLeader);
        } catch (error) {
          if (this.debug) {
            console.error("[Leadership] Error in callback", error);
          }
        }
      }
    }

    return changed;
  }

  /**
   * Check if the current tab is visible.
   *
   * @returns true if document is visible or visibility API is unavailable
   *
   * @private
   */
  private isTabVisible(): boolean {
    if (typeof document === "undefined") {
      // No document (e.g. Node.js) - assume visible
      return true;
    }

    // Check document.visibilityState
    // 'visible' = tab is visible
    // 'hidden' = tab is hidden (background tab, minimized window, etc.)
    return document.visibilityState === "visible";
  }
}

/**
 * Create a leadership detector with the given configuration.
 *
 * Convenience factory function.
 *
 * @param config - Leadership configuration
 *
 * @returns A new LeadershipDetector instance
 *
 * @example
 * ```ts
 * const detector = createLeadershipDetector({
 *   clientId: 'tab-123',
 *   onLeadershipChange: (isLeader) => {
 *     console.log('Leadership changed:', isLeader);
 *   }
 * });
 * ```
 */
export function createLeadershipDetector(config: LeadershipConfig): LeadershipDetector {
  return new LeadershipDetector(config);
}
