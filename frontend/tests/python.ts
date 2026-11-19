// Repository virtual environment interpreter, relative to frontend/; override with SENSIBILIA_PYTHON.
export const python =
  process.env.SENSIBILIA_PYTHON ??
  (process.platform === 'win32' ? '..\\.venv\\Scripts\\python.exe' : '../.venv/bin/python');
