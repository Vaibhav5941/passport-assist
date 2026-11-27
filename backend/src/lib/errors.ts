export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[] | undefined>,
  ) {
    super(message);
  }
}
export const notFound = () => new AppError(404, 'NOT_FOUND', 'The requested item was not found.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You are not allowed to perform this action.');
export const conflict = (code: string, message: string) => new AppError(409, code, message);
