# Event sync design

## Decyzja

Testy PayNote mają używać **jawnego helpera synchronizacyjnego** po każdej akcji biznesowej.

Nie uruchamiamy globalnego background interval, który stale pobiera eventy w tle.

## Dlaczego

Jawny sync point daje:

- przewidywalną kolejność akcji,
- łatwe logowanie i debug,
- prosty dedup po `eventId`,
- brak ukrytych race condition między testem a background workerem,
- prosty model timeoutów.

## Wzorzec użycia

```ts
await flow.acceptDelivery(...);
await eventPump.flushUntilSettled({
  sessionIds: [sessionId],
  assertSettled: async () => {
    await bank.waitForDeliveryAccepted(...);
    await bank.waitForSinglePostedCapture(...);
  },
});
```

## Co robi helper

1. pobiera nowe eventy z MyOS od ostatniego watermarka,
2. filtruje tylko `DOCUMENT_CREATED` i `DOCUMENT_EPOCH_ADVANCED`,
3. filtruje już przetworzone `eventId`,
4. sortuje eventy zgodnie z kolejnością dispatchu w lcloud,
5. dla każdego eventu pobiera pełny payload z `GET /myos-events/:id`,
6. wywołuje bank webhook z pełnym payloadem,
7. po dostarczeniu eventów sprawdza `assertSettled`,
8. czeka na quiet period bez nowych eventów,
9. kończy dopiero, gdy system wygląda na settled.

## Watermark

Najprostszy i wystarczająco stabilny model:

- przechowuj `fromIso` = największe `created` już widziane przez helper,
- przy kolejnym odczycie pytaj MyOS z `from=fromIso`,
- dedupuj po `eventId`, bo `from` jest inclusive (`gte`).

## Kiedy użyć trybu `{ id }`

Tylko w osobnym smoke teście sprawdzającym bankowy fallback `fetchEvent` path.

## Kiedy użyć tła

Tylko jeśli istnieje twarde ograniczenie runnera lub feedu, które uniemożliwia jawne sync pointy. To nie jest domyślny model.
