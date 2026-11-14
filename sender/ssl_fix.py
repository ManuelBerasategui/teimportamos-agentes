"""Arregla 'CERTIFICATE_VERIFY_FAILED' en algunas PCs con Windows (antivirus que revisa HTTPS, certificados viejos).
Usa los certificados de Windows (truststore) y, si no está, los de certifi. Si ninguno está instalado, no hace nada."""
try:
    import truststore
    truststore.inject_into_ssl()
except Exception:
    try:
        import ssl, certifi
        _ctx = lambda *a, **k: ssl.create_default_context(cafile=certifi.where())
        ssl._create_default_https_context = _ctx
    except Exception:
        pass
