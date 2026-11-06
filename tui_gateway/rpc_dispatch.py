"""JSON-RPC admission and worker dispatch. Rebound onto the server namespace."""

from __future__ import annotations

from .method_ctx import bind_module


def handle_request(req: dict) -> dict | None:
    from hermes_cli.backend_retirement import retirement

    with retirement.work() as admitted:
        if not admitted:
            return _err(req.get("id"), 5035, "backend is retiring; reconnect to continue")
        return _handle_admitted_request(req)


def _handle_admitted_request(req: dict) -> dict | None:
    normalized = _normalize_request(req)
    if isinstance(normalized, dict):
        return normalized
    rid, method, params = normalized
    if not (fn := _methods.get(method)):
        return _err(rid, -32601, _contracts.unknown_method_message(method))
    # Test doubles register straight into ``_methods`` without a contract; every production
    # handler comes through ``register_method`` and therefore has one.
    contract = _contracts.METHODS.get(method)
    if contract is not None:
        params, problem = _contracts.validate_params(contract, params)
        if problem is not None:
            return _err(rid, 4000, problem)
    from hermes_cli.config_backend import ConfigBackendUnavailable

    token = _current_rpc_method.set(method)
    try:
        response = fn(rid, params)
    except ProfileUnavailableError as exc:
        return _err(rid, 4064, str(exc))
    except ConfigBackendUnavailable as exc:
        # A SystemExit on purpose (readers must not fall back to defaults), so no ``except
        # Exception`` below catches it: this request still owes its caller one answer.
        return _err(rid, 4064, str(exc.code))
    finally:
        _current_rpc_method.reset(token)
    _log_turn_refusal(method, params, response)
    if contract is not None and isinstance(response, dict) and isinstance(response.get("result"), dict):
        _contracts.check_params_accepted(contract, params)
        _contracts.check_result(contract, response["result"])
    return response


#: Turn-admission RPCs whose refusal a client may swallow: the desktop queue drain retries a
#: refused send as a bare ``false`` and, after four tries, says only "Queued message not sent".
_LOGGED_REFUSAL_METHODS = frozenset({"prompt.submit", "session.resume"})


def _log_turn_refusal(method: str, params: dict, response) -> None:
    """One INFO line per refused turn admission, so the reason outlives the client's retry.
    Code, reason and session only: never the prompt text."""
    if method not in _LOGGED_REFUSAL_METHODS or not isinstance(response, dict):
        return
    error = response.get("error")
    if not isinstance(error, dict):
        return
    data = error.get("data")
    logger.info(
        "rpc refused: method=%s session=%s code=%s reason=%s queued=%s message=%.200s",
        method, params.get("session_id"), error.get("code"),
        data.get("reason") if isinstance(data, dict) else None,
        bool(params.get("queued")), error.get("message"))


def dispatch(req: dict, transport: Optional[Transport] = None) -> dict | None:
    """Route inbound RPCs — long handlers to the pool (returns None; the worker writes its own
    response via the bound transport), everything else inline (returns the response dict).
    *transport* pins every write of this request — events included — to that transport;
    omitted → the module stdio transport (``tui_gateway.entry`` behaviour)."""
    t = transport or _stdio_transport
    token = bind_transport(t)
    try:
        from tui_gateway import server_requests
        if server_requests.is_response_frame(req):
            # The renderer answering one of OUR requests (clarify, approval, …): no response frame goes back.
            if not server_requests.resolve_response(req, t) and not _relay_compute_host_response(req):
                logger.debug("dropping response for unknown server request id=%r", req.get("id"))
            return None
        normalized = _normalize_request(req)
        if isinstance(normalized, dict):
            return normalized
        if normalized[1] not in _LONG_HANDLERS:
            return handle_request(req)
        from hermes_cli.backend_retirement import retirement

        # Reserve BEFORE enqueueing: a queued handler has accepted work even though no worker runs yet.
        if not retirement.acquire():
            return _err(req.get("id"), 5035, "backend is retiring; reconnect to continue")
        try:
            ctx = contextvars.copy_context()  # the pool worker must see the bound transport
            owner = normalized[2].get("owner")
            if normalized[1] in _CONNECTOR_RPC_METHODS and isinstance(owner, dict) and owner.get("type") == "session":
                ctx.run(_capture_connector_rpc_owner, normalized[2])

            def run():
                try:
                    resp = _handle_admitted_request(req)
                except Exception as exc:
                    resp = _err(req.get("id"), -32000, f"handler error: {exc}")
                if resp is not None:
                    t.write(resp)
            future = _pool.submit(lambda: ctx.run(run))
        except BaseException:
            retirement.release()
            raise
        # Also releases cancelled queued futures; the worker's own finally would never execute.
        future.add_done_callback(lambda _: retirement.release())
        return None
    finally:
        reset_transport(token)


def register(server):
    bind_module(globals(), server)
