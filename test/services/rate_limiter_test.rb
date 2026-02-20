# frozen_string_literal: true

require "test_helper"

class RateLimiterTest < ActiveSupport::TestCase
  setup do
    @redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/1"))
    @redis.flushdb
  end

  teardown do
    @redis.flushdb
  end

  test "acquire! succeeds when under burst limit" do
    limiter = RateLimiter.new(redis: @redis)
    assert_nothing_raised { limiter.acquire! }
  end

  test "acquire! blocks when burst limit exceeded - waits for next second" do
    limiter = RateLimiter.new(redis: @redis)
    now = Time.now.to_i
    burst_key = "riot:rl:1s:#{now}"

    # Manually set count to 20 so next incr will exceed limit
    @redis.set(burst_key, RateLimiter::BURST_LIMIT)
    @redis.expire(burst_key, 2)

    # acquire! will loop: incr returns 21, sleep until next second, retry
    start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    limiter.send(:acquire_burst_slot!)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start

    assert elapsed >= 0.01, "Should block (sleep until next second boundary)"
  end

  test "acquire! blocks when sustained limit exceeded" do
    limiter = RateLimiter.new(redis: @redis)
    sustained_key = "riot:rl:120s"
    now_ms = (Time.now.to_f * 1000).to_i

    # Fill to 100; scores 119.9s–119s ago (in window); oldest yields ~0.1s sleep
    100.times { |i| @redis.zadd(sustained_key, now_ms - 119_900 + i, "req-#{i}") }
    @redis.expire(sustained_key, 180)

    start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    limiter.acquire!
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - start

    assert elapsed >= 0.05, "Should block when sustained limit reached"
  end
end
