import { User, UserId, UserName } from '../entities/User';

export interface UserRepository {
  /**
   * Find a user by their unique name
   * @param name The user name to search for
   * @returns Promise resolving to User if found, null if not found
   */
  findByName(name: UserName): Promise<User | null>;

  /**
   * Find a user by their unique ID
   * @param id The user ID to search for
   * @returns Promise resolving to User if found, null if not found
   */
  findById(id: UserId): Promise<User | null>;

  /**
   * Save a user (create or update)
   * @param user The user to save
   * @returns Promise resolving to the saved user
   */
  save(user: User): Promise<User>;

  /**
   * Check if a user exists with the given name
   * @param name The user name to check
   * @returns Promise resolving to true if user exists, false otherwise
   */
  existsByName(name: UserName): Promise<boolean>;
}
