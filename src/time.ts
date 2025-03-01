// Convert milliseconds to human-readable format
export function formatTimeSpent(totalTime: number): string {
  const hours = Math.floor(totalTime / (1000 * 60 * 60));
  const minutes = Math.floor((totalTime % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} hrs ${minutes} mins`;
}

// Check if time interval has passed (function removed as no longer needed - logic moved into tracker.ts)
