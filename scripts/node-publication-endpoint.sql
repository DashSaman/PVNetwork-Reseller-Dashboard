-- Run as the controller database administrator after authenticating a node's
-- replacement address. No addresses, credentials or client records belong here.
-- Provision legacy_public_address separately for the exact relocated node.
-- public_address and bridge_port are already installed ownership metadata.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE public.t6_node_ownership_publication
    ADD COLUMN IF NOT EXISTS legacy_public_address text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.t6_node_publication_proxy_endpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    former_address text;
    current_address text;
    stream jsonb;
    endpoints jsonb;
BEGIN
    SELECT p.legacy_public_address, p.public_address
      INTO former_address, current_address
      FROM public.t6_node_ownership_publication p
      JOIN public.nodes n ON n.id = p.node_id
     WHERE p.node_id = NEW.node_id
       AND n.address = '127.0.0.1' AND n.port = p.bridge_port;
    IF NOT FOUND OR former_address = '' OR current_address = ''
       OR former_address = current_address THEN RETURN NEW; END IF;

    -- Keep explicit alternative/CDN endpoints, SNI, protocol and client fields.
    -- A node heartbeat may re-import the previous default publication address.
    BEGIN
        stream := NEW.stream_settings::jsonb;
    EXCEPTION WHEN invalid_text_representation THEN RETURN NEW;
    END;
    IF jsonb_typeof(stream->'externalProxy') IS DISTINCT FROM 'array'
       THEN RETURN NEW; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(stream->'externalProxy') e
         WHERE e->>'dest' = former_address
    ) THEN RETURN NEW; END IF;

    SELECT jsonb_agg(CASE WHEN e->>'dest' = former_address
                         THEN jsonb_set(e, '{dest}', to_jsonb(current_address))
                         ELSE e END ORDER BY position)
      INTO endpoints
      FROM jsonb_array_elements(stream->'externalProxy')
           WITH ORDINALITY AS item(e, position);
    NEW.stream_settings := jsonb_set(stream, '{externalProxy}', endpoints)::text;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t6_node_publication_proxy_endpoint ON public.inbounds;
CREATE TRIGGER t6_node_publication_proxy_endpoint
BEFORE INSERT OR UPDATE OF node_id, stream_settings ON public.inbounds
FOR EACH ROW EXECUTE FUNCTION public.t6_node_publication_proxy_endpoint();
COMMIT;
