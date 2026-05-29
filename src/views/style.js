const estiloCSS = `
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #e0e5ec; color: #333; }
        .navbar { background: #2c3e50; padding: 15px; color: white; display: flex; gap: 20px; }
        .navbar a { color: white; text-decoration: none; font-weight: bold; }
        .navbar a:hover { color: #3498db; }
        .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
        .card { background: white; padding: 25px; border-radius: 10px; box-shadow: 5px 5px 15px #c8d0e7, -5px -5px 15px #ffffff; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background-color: #f8f9fa; }
        .btn { padding: 8px 15px; cursor: pointer; background: #3498db; color: white; border: none; border-radius: 5px; font-weight: bold; }
        .btn:hover { background: #2980b9; }
        .btn:disabled { background: #95a5a6; cursor: not-allowed; }
        .input-text { padding: 8px; font-size: 16px; border-radius: 5px; border: 1px solid #ccc; width: 200px; }
    </style>
`;

module.exports = { estiloCSS };