export class AccountNumberGenerator {
  private counter = 0;

  generate(): string {
    // Get current timestamp in milliseconds
    const timestamp = Date.now();

    // Increment counter for uniqueness within the same millisecond
    this.counter = (this.counter + 1) % 1000;

    // Combine timestamp and counter to create a unique number
    // Use last 7 digits of timestamp + 3 digit counter
    const timestampPart = timestamp % 10000000; // Last 7 digits
    const counterPart = this.counter.toString().padStart(3, '0');

    // Ensure exactly 10 digits, pad if needed
    const accountNumber = (timestampPart.toString() + counterPart).padStart(
      10,
      '0'
    );

    return accountNumber;
  }
}
